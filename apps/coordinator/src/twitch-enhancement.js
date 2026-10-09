import { setTimeout as delay } from 'node:timers/promises';
import { fetchBootstrap } from '../../../packages/adapters/twitch/ffz-bootstrap.js';
import { enhancementExpression, validateEmoteOptions } from '../../../packages/adapters/twitch/enhancement.js';

function boundedSnapshot(input) {
  const string = (value, limit) => value == null ? null : typeof value === 'string' ? value.slice(0,limit) : invalid();
  const invalid = () => { throw new Error('Unsupported enhancement diagnostics.'); };
  const count = (value, limit) => Number.isInteger(value) && value >= 0 && value <= limit ? value : invalid();
  if (typeof input.resetRequired !== 'boolean') invalid();
  const result = { status: input.status, reason: string(input.reason,240), resetRequired: input.resetRequired,
    engineVersion: string(input.engineVersion,128), providers: input.providers.map(provider => {
      if (!['7tv-emotes', 'ffzap-bttv'].includes(provider.id) || typeof provider.moduleReady !== 'boolean') invalid();
      return { id: provider.id, moduleReady: provider.moduleReady, version: string(provider.version,80),
        setCount: count(provider.setCount,2048), emoteCount: count(provider.emoteCount,20000),
        countsTruncated: provider.countsTruncated === true,
        dataStatus: ['available', 'empty-or-pending'].includes(provider.dataStatus) ? provider.dataStatus : invalid() };
    }) };
  if (input.awaitingNative) result.awaitingNative = true;
  if (input.compatibilityVersion !== undefined) result.compatibilityVersion = count(input.compatibilityVersion,2);
  if (input.isolation) {
    const info = input.isolation;
    if (!['pending', 'isolated', 'released'].includes(info.status) || !Array.isArray(info.settings) || info.settings.length > 16) invalid();
    result.isolation = { status: info.status, registrationRetained: info.registrationRetained === true,
      entries: count(info.entries,256), maxEntries: 256, maxBytes: 65536, maxValueBytes: 4096,
      maxUiValueBytes: 32768, uiWritesDropped: count(info.uiWritesDropped ?? 0,1000000),
      settings: info.settings.map(record => {
        if (typeof record.key !== 'string' || record.key.length > 128) invalid();
        const scalar = value => value == null || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) ? value ?? null : string(value,80);
        let applied = record.applied;
        if (applied && typeof applied === 'object') {
          const entries = Object.entries(applied);
          if (entries.length > 8 || entries.some(([key,value]) => key.length > 80 || typeof value !== 'boolean')) invalid();
          applied = Object.fromEntries(entries);
        } else applied = scalar(applied);
        return { key: record.key, priorDefault: scalar(record.priorDefault), applied };
      }) };
  }
  return result;
}

/** One asynchronous worker, one document binding, and no work in native cycles. */
export class TwitchEnhancement {
  #owner;
  #emotes;
  #desired;
  #job;
  #controller;
  #state = { status: 'off', reason: null, resetRequired: false, providers: [] };
  #bootstrap;
  #nextPoll = 0;
  #terminal;
  #suppressed = false;
  #resetUsed = false;
  #resetOutcome = 'none';
  #lastFailure = null;
  #stopped = false;
  #download;
  #clock;
  #timeout;
  #poll;
  #retry;
  #attempts = 0;
  #evaluate;

  constructor(emotes, owner, { download = signal => fetchBootstrap(fetch, signal), clock = () => Date.now(),
    timeoutMs = 65000, pollMs = 1000, retryMs = 250,
    evaluate = (binding, command) => binding.page.frames.evaluate(binding.context, enhancementExpression(command)) } = {}) {
    this.#emotes = validateEmoteOptions(emotes); this.#owner = owner;
    this.#download = download; this.#clock = clock; this.#timeout = timeoutMs; this.#poll = pollMs; this.#retry = retryMs;
    this.#evaluate = evaluate;
  }

  diagnostics() {
    return { ...structuredClone(this.#state), lastFailure: structuredClone(this.#lastFailure),
      attempts: this.#attempts, resetAttempted: this.#resetUsed, resetOutcome: this.#resetOutcome,
      resetRequested: this.#resetOutcome === 'requested', activeWork: !!this.#job };
  }

  sync(page, record, documentUrl) {
    if (this.#stopped || !this.#emotes.sevenTv && !this.#emotes.betterTtv) return;
    if (this.#desired?.page !== page || this.#desired?.context !== record.context || this.#desired?.sessionId !== record.sessionId) {
      this.#controller?.abort();
      this.#desired = { page, context: record.context, sessionId: record.sessionId, documentUrl, begun: false };
      this.#terminal = undefined; this.#nextPoll = 0;
      this.#state = { status: this.#suppressed ? 'unavailable' : 'loading',
        reason: this.#suppressed ? 'Emotes paused after partial initialization; native Twitch recovered. Restart or retry explicitly to enable emotes.' : null,
        resetRequired: false, providers: [] };
    }
    // Twitch can update its URL without replacing the execution context while
    // the bootstrap downloads. Only discovery may supply the fresh URL, and
    // only before the wrapper has acknowledged installation.
    if (!this.#desired.begun) this.#desired.documentUrl = documentUrl;
    this.#kick();
  }

  detach(recover = false, reason) {
    if (this.#stopped) return;
    const binding = this.#desired;
    if (recover && binding && !this.#lastFailure) this.#lastFailure = { ...structuredClone(this.#state),
      status: 'unavailable', stage: 'native-adapter', reason: String(reason ?? 'Native Twitch adapter failed before enhancement polling.').slice(0,240) };
    if (binding && recover) binding.recover = true;
    this.#controller?.abort(); this.#desired = undefined; this.#terminal = undefined;
    if (this.#state.status !== 'off') this.#state = { ...this.#state, status: 'unavailable', reason: 'Waiting for the selected Twitch generation.' };
    if (binding && !this.#job) {
      this.#job = this.#release(binding).finally(() => { this.#job = undefined; this.#kick(); });
    }
  }

  #live(binding, signal) {
    return !signal.aborted && !this.#stopped && this.#desired === binding &&
      !binding.page.disconnected && binding.page.has(binding.context);
  }

  #kick() {
    const binding = this.#desired;
    if (!binding || this.#job || this.#suppressed || this.#terminal === binding || this.#clock() < this.#nextPoll) return;
    const controller = new AbortController(); this.#controller = controller;
    this.#job = this.#run(binding, controller.signal).finally(async () => {
      if (this.#desired !== binding) await this.#release(binding);
      this.#job = undefined;
      if (this.#desired && this.#desired !== binding) this.#kick();
    });
  }

  async #call(binding, operation, fields = {}) {
    const result = await this.#evaluate(binding, { operation, owner: this.#owner,
      sessionId: binding.sessionId, documentUrl: binding.documentUrl, emotes: this.#emotes, ...fields });
    if (['begin', 'poll', 'stop'].includes(operation) && (!result || !['loading', 'ready', 'unavailable'].includes(result.status) || !Array.isArray(result.providers) || result.providers.length > 2)) {
      throw new Error('Unsupported enhancement status response.');
    }
    if (result?.awaitingNative !== undefined && (operation !== 'begin' || result.awaitingNative !== true ||
        result.status !== 'loading' || result.resetRequired !== false || result.providers.length)) {
      throw new Error('Unsupported native preparation response.');
    }
    return ['begin', 'poll', 'stop'].includes(operation) ? boundedSnapshot(result) : result;
  }

  async #release(binding) {
    if (binding.begun && !binding.page.disconnected && binding.page.has(binding.context)) {
      try {
        const stopped = await this.#call(binding, 'stop');
        if (binding.recover) await this.#recover(binding, stopped.resetRequired);
      } catch { /* A replacement binding must never be stopped. */ }
    }
  }

  async #recover(binding, resetRequired) {
    if (!resetRequired || this.#resetUsed || this.#stopped || this.#desired && this.#desired !== binding ||
        binding.page.disconnected || !binding.page.has(binding.context)) return;
    // Exactly one recovery refresh per lifecycle, including failures detected
    // by the native adapter before the slower enhancement readiness poll.
    this.#state.resetRequired = true;
    this.#lastFailure ??= { ...structuredClone(this.#state), stage: 'recovery' };
    this.#resetUsed = true; this.#suppressed = true; this.#resetOutcome = 'unconfirmed';
    const result = await this.#call(binding, 'reset');
    if (result?.resetRequested) this.#resetOutcome = 'requested';
  }

  async #run(binding, signal) {
    const live = () => this.#live(binding, signal);
    const begin = async () => {
      binding.begun = true; // Response loss can still mean the script ran.
      const snapshot = await this.#call(binding, 'begin', { integrity: this.#bootstrap?.integrity });
      if (!live()) return;
      // Only this explicit, pre-mutation response proves that no loader ran.
      if (snapshot.awaitingNative) binding.begun = false;
      this.#state = snapshot;
    };
    try {
      if (!binding.begun) {
        const existing = await this.#call(binding, 'inspect');
        if (!live()) return;
        if (existing && !existing.owned) throw new Error('Twitch emotes are owned by another enhancement session.');
        if (!existing && !this.#bootstrap) {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            try { this.#attempts += 1; this.#bootstrap = await this.#download(signal); break; }
            catch (error) {
              if (!live() || attempt === 1) throw error;
              await delay(this.#retry, undefined, { signal });
            }
          }
        }
        if (!live()) return;
        await begin();
      } else {
        const snapshot = await this.#call(binding, 'poll');
        if (!live()) return;
        this.#state = snapshot;
      }
      const deadline = this.#clock() + this.#timeout;
      while (live()) {
        if (this.#state.status === 'unavailable') throw new Error(this.#state.reason ?? 'Emotes unavailable.');
        if (this.#state.status === 'ready') { this.#nextPoll = this.#clock() + 5000; return; }
        if (this.#clock() >= deadline) throw new Error(binding.begun ? 'Emote enhancement readiness timed out.' :
          `Native Twitch preparation timed out: ${this.#state.reason ?? 'document not ready'}`);
        await delay(this.#poll, undefined, { signal });
        if (!live()) return;
        if (!binding.begun) await begin();
        else {
          const snapshot = await this.#call(binding, 'poll');
          if (!live()) return;
          this.#state = snapshot;
        }
      }
    } catch (error) {
      if (!live()) return;
      this.#terminal = binding;
      this.#state = { ...this.#state, status: 'unavailable', reason: String(error?.message ?? error).slice(0,240) };
      this.#lastFailure = { ...structuredClone(this.#state), stage: 'enhancement' };
      if (binding.begun) {
        try {
          const stopped = await this.#call(binding, 'stop');
          if (!live()) return;
          this.#state.resetRequired = stopped.resetRequired;
          await this.#recover(binding, stopped.resetRequired);
        } catch { /* Ownership/context/transport changed: do not retry reload. */ }
      }
    }
  }

  async stop() {
    this.#stopped = true; this.#controller?.abort();
    const binding = this.#desired; this.#desired = undefined;
    await this.#job;
    if (binding?.begun && !binding.page.disconnected && binding.page.has(binding.context)) {
      try { this.#state = await this.#call(binding, 'stop'); } catch { /* No unload claim when context is gone. */ }
    }
    return this.diagnostics();
  }
}
