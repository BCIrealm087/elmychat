import { randomUUID } from 'node:crypto';
import { Compositor } from '../../../packages/compositor/index.js';
import { requireLoopback } from '../../../packages/browser-control/cdp.js';
import { NativePage } from '../../../packages/browser-control/native-page.js';
import { validateEmoteOptions } from '../../../packages/adapters/twitch/enhancement.js';
import { TwitchEnhancement } from './twitch-enhancement.js';

export function validateRuntimeConfig(input) {
  if (!input || typeof input !== 'object') throw new TypeError('Coordinator config is required.');
  requireLoopback(input.endpoint);
  if (!input.targetId && !input.targetUrl) throw new Error('Provide targetId or exact targetUrl.');
  if (input.targetId !== undefined && (typeof input.targetId !== 'string' || !input.targetId.length || input.targetId.length > 512)) throw new Error('Invalid targetId.');
  if (input.targetUrl !== undefined) requireLoopback(input.targetUrl);
  const gap = input.gap ?? 12;
  const maxEntries = input.maxEntries ?? 500;
  const intervalMs = input.intervalMs ?? 100;
  if (!Number.isFinite(gap) || gap < 0 || gap > 10000) throw new Error('gap must be 0..10000.');
  if (!Number.isInteger(maxEntries) || maxEntries < 1 || maxEntries > 500) throw new Error('maxEntries must be 1..500.');
  if (!Number.isInteger(intervalMs) || intervalMs < 50 || intervalMs > 5000) throw new Error('intervalMs must be 50..5000.');
  if (!Array.isArray(input.sources) || input.sources.length !== 2) throw new Error('Configure exactly Twitch and YouTube.');
  const ids = new Set();
  const platforms = new Set();
  const sources = input.sources.map(({ id, platform, urlPrefix, emotes }) => {
    if (typeof id !== 'string' || !id.length || id.length > 512 || ids.has(id)) throw new Error('Source IDs must be unique nonempty strings.');
    if (!['twitch', 'youtube'].includes(platform) || platforms.has(platform)) throw new Error('Configure one source per supported platform.');
    if (typeof urlPrefix !== 'string') throw new Error('Source urlPrefix is required.');
    const url = new URL(urlPrefix);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.pathname === '/') throw new Error('Source prefixes require an HTTP(S) chat path without credentials or hash.');
    if (platform !== 'twitch' && emotes !== undefined) throw new Error('Emote enhancement is Twitch-only.');
    const choices = platform === 'twitch' ? validateEmoteOptions(emotes) : undefined;
    if (choices && (choices.sevenTv || choices.betterTtv) && (url.origin !== 'https://www.twitch.tv' || !/^\/embed\/[a-z0-9_]{1,25}\/chat$/.test(url.pathname))) {
      throw new Error('Emote enhancement requires the selected native Twitch embed.');
    }
    ids.add(id); platforms.add(platform);
    return { id, platform, urlPrefix: url.href, ...(choices ? { emotes: choices } : {}) };
  });
  return { endpoint: input.endpoint, targetId: input.targetId, targetUrl: input.targetUrl, gap, maxEntries, intervalMs, sources };
}

function matches(url, prefix) {
  const actual = new URL(url);
  const expected = new URL(prefix);
  const pathMatches = actual.pathname === expected.pathname || (expected.pathname.endsWith('/') ? actual.pathname.startsWith(expected.pathname) : actual.pathname.startsWith(`${expected.pathname}/`));
  return actual.origin === expected.origin && pathMatches && [...expected.searchParams].every(([key, value]) => actual.searchParams.get(key) === value);
}

function sourceMatches(frame, source) {
  if (frame.topLevel || !matches(frame.url, source.urlPrefix)) return false;
  return !source.emotes?.sevenTv && !source.emotes?.betterTtv || new URL(frame.url).pathname === new URL(source.urlPrefix).pathname;
}

export function validateSpacingCommand(command) {
  if (!command || !['gap', 'spacer-add', 'spacer-update', 'spacer-remove'].includes(command.type)) throw new TypeError('Unknown spacing command.');
  if (command.type !== 'spacer-remove' && (!Number.isFinite(command.height) || command.height < 0 || command.height > 10000)) throw new RangeError('Spacing must be 0..10000 pixels.');
  if (['spacer-update', 'spacer-remove'].includes(command.type) && (typeof command.spacerId !== 'string' || !command.spacerId.length || command.spacerId.length > 512)) throw new TypeError('A spacer identity is required.');
  return { type: command.type, ...(command.type !== 'spacer-remove' ? { height: command.height } : {}), ...(['spacer-update', 'spacer-remove'].includes(command.type) ? { spacerId: command.spacerId } : {}) };
}

/** One awaited cycle at a time; no queue of ticks or concurrent layout writers. */
export class NativeCoordinator {
  #page;
  #pinnedId;
  #targetUrl;
  #owner = randomUUID();
  #generation = 0;
  #records = new Map();
  #blocked = new Map();
  #work;
  #stopping = false;
  #stopWork;
  #open;
  #clock;
  #lastError = null;
  #cycles = 0;
  #cleanup = [];
  #sourceStates = new Map();
  #controls = [];
  #activity = { connections: 0, sessionsStarted: 0, reportsProcessed: 0, layoutWrites: 0, lastCycleMs: 0, longestCycleMs: 0 };
  #enhancement;
  #createEnhancement;
  #refresh;
  #startRefresh;

  constructor(config, { openPage = NativePage.open, clock = () => performance.now(), refreshTwitchUrl,
    createEnhancement = (emotes, owner) => new TwitchEnhancement(emotes, owner) } = {}) {
    this.config = validateRuntimeConfig(config);
    this.compositor = new Compositor({ viewport: { width: 0, height: 0 }, gap: this.config.gap, maxEntries: this.config.maxEntries, maxSources: 2 });
    this.#open = openPage;
    this.#clock = clock;
    this.#createEnhancement = createEnhancement;
    this.#startRefresh = refreshTwitchUrl;
    this.#enhancement = createEnhancement(this.config.sources.find(source => source.platform === 'twitch').emotes, this.#owner);
  }

  diagnostics() {
    const sources = this.config.sources.map(({ id, platform }) => ({ id, platform, ...this.#sourceStates.get(id),
      ...(platform === 'twitch' ? { enhancement: this.#enhancement.diagnostics(), refresh: this.#refresh ? { revision: this.#refresh.revision, status: this.#refresh.status, reason: this.#refresh.reason } : null } : {}) }));
    return {
      status: this.#stopping ? 'stopped' : this.#lastError ? 'waiting' : this.#page ? 'connected' : 'waiting',
      targetId: this.#pinnedId ?? null, cycles: this.#cycles, lastError: this.#lastError,
      chatConnected: !this.#stopping && !this.#page?.disconnected && sources.every((source) => source.status === 'running'),
      sources, layout: this.compositor.layout(), cleanup: this.#cleanup.map((entry) => ({ ...entry })),
      resources: {
        retainedEntries: this.compositor.size, activeSessions: this.#records.size,
        blockedSources: this.#blocked.size, pendingControls: this.#controls.length, cleanupEntries: this.#cleanup.length,
      },
      bounds: { history: this.config.maxEntries, sources: 2, rootsPerSource: 500, reportsPerSource: 1000, styledNodesPerSource: 4096, spacers: 32, pendingControls: 32, cleanup: 16 },
      activity: { ...this.#activity },
    };
  }

  step() {
    if (this.#stopping) return Promise.resolve(this.diagnostics());
    if (this.#work) return this.#work;
    this.#work = this.#cycle().finally(() => {
      this.#work = undefined;
      if (this.#controls.length && !this.#stopping) queueMicrotask(() => { void this.step(); });
    });
    return this.#work;
  }

  control(input) {
    const command = validateSpacingCommand(input);
    return this.#enqueue(command);
  }

  applyEmotes(input, expectedUrl, retry = false) {
    const emotes = validateEmoteOptions(input);
    const source = this.config.sources.find(source => source.platform === 'twitch');
    // Validate the new choices against the same embed restriction as startup.
    validateRuntimeConfig({ ...this.config, sources: this.config.sources.map(item => item === source ? { ...item, emotes } : item) });
    if (typeof expectedUrl !== 'string' || !matches(expectedUrl, source.urlPrefix)) throw new TypeError('Twitch refresh URL does not match the configured source.');
    return this.#enqueue({ type: 'emotes', emotes, expectedUrl, retry });
  }

  #enqueue(command) {
    if (this.#stopping) return Promise.reject(new Error('Coordinator is stopped.'));
    if (this.#controls.length >= 32) return Promise.reject(new Error('Too many pending spacing commands.'));
    return new Promise((resolve, reject) => {
      this.#controls.push({ command, resolve, reject });
      void this.step();
    });
  }

  async #applyControl(command) {
    if (command.type === 'emotes') return this.#applyEmotes(command);
    if (command.type === 'gap') {
      this.compositor.setGap(command.height);
      this.config.gap = command.height;
      return { accepted: true, removed: [] };
    }
    const spacers = this.compositor.entries().filter((entry) => entry.kind === 'spacer');
    if (command.type === 'spacer-add') {
      if (spacers.length >= 32) throw new RangeError('At most 32 retained spacers are supported.');
      return this.compositor.setSpacer({ spacerId: randomUUID(), height: command.height });
    }
    if (!spacers.some((entry) => entry.spacerId === command.spacerId)) throw new Error('Spacer is no longer retained.');
    return command.type === 'spacer-remove' ? this.compositor.removeSpacer(command.spacerId) : this.compositor.setSpacer({ spacerId: command.spacerId, height: command.height });
  }

  async #applyEmotes(command) {
    const source = this.config.sources.find(source => source.platform === 'twitch');
    if (!command.retry && JSON.stringify(source.emotes) === JSON.stringify(command.emotes)) return { accepted: true, removed: [] };
    if (!this.#page || this.#page.disconnected) throw new Error('Wait for the selected OBS overlay to connect before applying emotes.');
    const frames = await this.#page.describe();
    const tops = frames.filter(frame => frame.topLevel);
    if (this.#stopping || tops.length !== 1 || tops[0].url !== this.#targetUrl) throw new Error('Selected overlay changed before applying emotes.');
    const fields = { overlayUrl: this.#targetUrl, expectedUrl: command.expectedUrl };
    const call = (operation, revision) => this.#page.frames.evaluate(tops[0].context,
      `(() => { if (location.href !== ${JSON.stringify(this.#targetUrl)}) throw new Error('Selected overlay changed.'); const api = globalThis.__elmychatManagedOverlayV1; if (!api) throw new Error('Reload the managed Elmychat overlay before applying emotes.'); return api.twitch(${JSON.stringify({ ...fields, operation, revision })}); })()`);
    // Preflight failures leave the live loader and native sessions untouched.
    const available = await call('inspect');
    if (!available?.available || this.#stopping || this.#page.disconnected) throw new Error('Managed Twitch refresh is unavailable.');
    fields.previousRevision = available.revision ?? null;
    const oldContext = frames.find(frame => sourceMatches(frame, source))?.context;
    await this.#enhancement.stop();
    await this.#retire(source.id, 'emote-settings-refresh');
    this.#blocked.delete(source.id);
    source.emotes = command.emotes;
    this.#enhancement = this.#createEnhancement(source.emotes, this.#owner);
    const revision = randomUUID();
    this.#refresh = { revision, oldContext, status: 'requested', reason: null, deadline: this.#clock() + 15000 };
    // After committing the transition, response loss is recorded, never retried
    // automatically. The fresh native context is the reconnection evidence.
    try {
      const result = await call('refresh', revision);
      if (!result?.acknowledged || result.revision !== revision) throw new Error('Twitch refresh was not acknowledged.');
    } catch (error) {
      this.#refresh.status = 'unconfirmed';
      this.#refresh.reason = `Twitch refresh could not be confirmed: ${String(error.message).slice(0,180)}`;
    }
    return { accepted: true, removed: [] };
  }

  #collectRetirements(result, retired) {
    for (const entry of result.removed ?? []) if (entry.reason === 'history-limit' && entry.kind === 'message') {
      const current = retired.get(entry.sourceId);
      const group = current?.sessionId === entry.sessionId ? current : { sessionId: entry.sessionId, messageIds: new Set() };
      group.messageIds.add(entry.messageId);
      retired.set(entry.sourceId, group);
    }
  }

  async #retire(id, reason, restore = true, recoverEnhancement = false) {
    const record = this.#records.get(id);
    if (this.config.sources.find(source => source.id === id)?.platform === 'twitch') this.#enhancement.detach(recoverEnhancement, reason);
    if (record) {
      this.compositor.retireSource(id, record.sessionId);
      this.#records.delete(id);
      if (restore) {
        try {
          if (!this.#page?.has(record.context) || this.#page.disconnected) throw new Error('Context or transport unavailable; restoration cannot be confirmed.');
          const result = await this.#page.call(record.context, record.platform, 'stop', { sourceId: id, sessionId: record.sessionId });
          this.#cleanup.push({ sourceId: id, sessionId: record.sessionId, restored: result?.restored === true, reason: result?.reason ?? reason });
        } catch (error) { this.#cleanup.push({ sourceId: id, sessionId: record.sessionId, restored: false, reason: error.message }); }
        this.#cleanup = this.#cleanup.slice(-16);
      }
    }
    this.#sourceStates.set(id, { status: 'waiting', reason });
  }

  async #disconnect(reason) {
    for (const { id } of this.config.sources) await this.#retire(id, reason);
    this.#page?.close();
    this.#page = undefined;
    this.#blocked.clear();
  }

  async #command(record, method, fields = {}) {
    const result = await this.#page.call(record.context, record.platform, method, { sourceId: record.sourceId, sessionId: record.sessionId, ...fields });
    if (this.#stopping || this.#page.disconnected) throw new Error('Coordinator stopped or transport disconnected during command.');
    if (!result?.accepted || (result.status && result.status !== 'running')) throw new Error(result?.failure ?? result?.reason ?? 'Adapter command failed.');
    return result;
  }

  async #cycle() {
    const started = this.#clock();
    this.#cycles += 1;
    const retired = new Map();
    const replies = [];
    for (const control of this.#controls.splice(0)) {
      try {
        const result = await this.#applyControl(control.command);
        this.#collectRetirements(result, retired);
        replies.push({ resolve: control.resolve, result });
      } catch (error) { control.reject(error); }
    }
    try {
      if (this.#page?.disconnected) await this.#disconnect('transport-disconnected');
      if (!this.#page) {
        this.#page = await this.#open(this.config, this.#pinnedId);
        this.#activity.connections += 1;
        this.#pinnedId ??= this.#page.target.id;
        this.#targetUrl ??= this.config.targetUrl ?? this.#page.target.url;
      }
      const frames = await this.#page.describe();
      if (this.#stopping || this.#page.disconnected) throw new Error('Coordinator stopped or transport disconnected during discovery.');
      const tops = frames.filter((frame) => frame.topLevel);
      if (tops.length !== 1 || tops[0].url !== this.#targetUrl) {
        for (const { id } of this.config.sources) await this.#retire(id, 'selected-page-changed');
        throw new Error('Selected page is not at its original exact URL.');
      }
      this.compositor.setViewport({ width: tops[0].width, height: tops[0].height });
      const matched = this.config.sources.map((source) => frames.filter((frame) => sourceMatches(frame, source)));
      if (matched[0].some((first) => matched[1].some((second) => first.context === second.context))) throw new Error('Source prefixes overlap on the same frame.');
      const twitchSource = this.config.sources.find(source => source.platform === 'twitch');
      const twitchFrames = frames.filter(frame => sourceMatches(frame, twitchSource));
      if (this.#startRefresh && twitchFrames.length === 1 && twitchFrames[0].documentReady !== false) {
        const expectedUrl = this.#startRefresh;
        this.#startRefresh = undefined; // One bounded attempt, never a loop.
        try { await this.#applyEmotes({ emotes: twitchSource.emotes, expectedUrl, retry: true }); }
        catch (error) {
          this.#refresh = { revision: null, status: 'unavailable', reason: String(error.message).slice(0,240),
            oldContext: twitchFrames[0].context, deadline: this.#clock() };
        }
      }
      for (const source of this.config.sources) {
        if (this.#stopping || this.#page.disconnected) throw new Error('Coordinator stopped or transport disconnected.');
        const candidates = frames.filter((frame) => sourceMatches(frame, source));
        if (source.platform === 'twitch' && this.#refresh && this.#refresh.status !== 'ready') {
          if (candidates.length !== 1 || candidates[0].context === this.#refresh.oldContext || candidates[0].documentReady === false) {
            if (this.#clock() >= this.#refresh.deadline) {
              this.#refresh.status = 'unavailable';
              this.#refresh.reason ??= 'Twitch did not reconnect after the refresh; retry explicitly.';
            }
            if (this.#refresh.status !== 'unavailable' || candidates.length !== 1 || candidates[0].documentReady === false) {
              this.#sourceStates.set(source.id, { status: 'waiting', reason: 'emote-settings-refresh' });
              continue;
            }
            // Resume native composition if a refresh was refused/lost. Never
            // install the newly chosen enhancer into the unrefreshed document.
          } else {
            this.#refresh.status = 'ready'; this.#refresh.reason = null;
            this.#refresh.oldContext = undefined;
          }
        }
        let record = this.#records.get(source.id);
        if (candidates.length !== 1 || (record && candidates[0].context !== record.context)) {
          await this.#retire(source.id, candidates.length > 1 ? 'ambiguous-source-frame' : 'frame-replaced-or-missing');
          record = undefined;
        }
        if (candidates.length !== 1) continue;
        const { context, documentReady } = candidates[0];
        if (!record && documentReady === false) {
          this.#sourceStates.set(source.id, { status: 'waiting', reason: 'native-document-loading' });
          continue;
        }
        const block = this.#blocked.get(source.id);
        if (block?.context === context) { this.#sourceStates.set(source.id, { status: 'failed', reason: block.reason }); continue; }
        this.#blocked.delete(source.id);
        try {
          if (!record) {
            if (tops[0].width === 0) continue;
            record = { sourceId: source.id, platform: source.platform, context, sessionId: `${this.#owner}:${++this.#generation}`, width: tops[0].width, revision: 0, snapshot: null };
            // Track before awaiting so shutdown/failure can restore an injection
            // even when its response was lost.
            this.#records.set(source.id, record);
            const installation = await this.#page.install(context, source.platform, { sourceId: source.id, sessionId: record.sessionId, width: record.width, maxRoots: 500, maxReports: 1000 }, this.#owner);
            if (this.#stopping || this.#page.disconnected) throw new Error('Transport changed during installation.');
            if (installation?.waitingForDocument) {
              this.#records.delete(source.id);
              this.#sourceStates.set(source.id, { status: 'waiting', reason: 'native-document-loading' });
              continue;
            }
            this.compositor.activateSource(source.id, record.sessionId);
            this.#activity.sessionsStarted += 1;
          }
          if (tops[0].width > 0 && record.width !== tops[0].width) {
            await this.#command(record, 'setWidth', { width: tops[0].width });
            record.width = tops[0].width;
          }
          const batch = await this.#command(record, 'takeReports');
          if (!Array.isArray(batch.events) || batch.events.length > 1000) throw new Error('Invalid or excessive report batch.');
          for (const event of batch.events) {
            if (event.sourceId !== source.id || event.sessionId !== record.sessionId) continue;
            const report = { ...event, receivedAtMs: this.#clock() };
            let result;
            if (event.type === 'added') result = this.compositor.addMessage(report);
            else if (event.type === 'resized') result = this.compositor.resizeMessage(report);
            else if (event.type === 'removed') result = this.compositor.removeMessage(report);
            else throw new Error('Unknown adapter report type.');
            this.#collectRetirements(result, retired);
            this.#activity.reportsProcessed += 1;
          }
          this.#sourceStates.set(source.id, {
            status: batch.diagnostics?.waitingForContainer ? 'waiting' : 'running',
            sessionId: record.sessionId, waitingForContainer: batch.diagnostics?.waitingForContainer ?? false,
            trackedRoots: batch.diagnostics?.trackedRoots ?? null,
            adapter: batch.diagnostics ? Object.fromEntries(['trackedRoots', 'retiredRoots', 'pendingReports', 'styledNodes', 'added', 'removed', 'resized', 'styleRepairs', 'flushes', 'rendererIdentifiedRoots', 'identityTransfers'].map((key) => [key, batch.diagnostics[key] ?? null])) : null,
          });
          if (source.platform === 'twitch' && (!this.#refresh || this.#refresh.status === 'ready')) this.#enhancement.sync(this.#page, record, candidates[0].url);
        } catch (error) {
          this.#blocked.set(source.id, { context, reason: error.message });
          await this.#retire(source.id, error.message, true, true);
          this.#sourceStates.set(source.id, { status: 'failed', reason: error.message });
        }
      }
      for (const [sourceId, group] of retired) {
        const record = this.#records.get(sourceId);
        if (record?.sessionId === group.sessionId) {
          try { await this.#command(record, 'retireMessages', { messageIds: [...group.messageIds] }); }
          catch (error) {
            this.#blocked.set(sourceId, { context: record.context, reason: error.message });
            await this.#retire(sourceId, error.message, true, true);
            this.#sourceStates.set(sourceId, { status: 'failed', reason: error.message });
          }
        }
      }
      // A failure while applying a snapshot also retires that source. One extra
      // bounded pass updates any healthy source already sent the previous layout.
      for (let pass = 0; pass < 2; pass += 1) {
        let failed = false;
        const layout = this.compositor.layout();
        const writes = [];
        for (const [sourceId, record] of this.#records) {
          if (this.#stopping || this.#page.disconnected) throw new Error('Coordinator stopped or transport disconnected.');
          const placements = layout.placements.filter((entry) => entry.sourceId === sourceId && entry.sessionId === record.sessionId);
          const snapshot = JSON.stringify(placements);
          if (snapshot !== record.snapshot) {
            writes.push({ sourceId, record, snapshot, placements });
          }
        }
        // At most two source writes. Dispatch the same snapshot together so a
        // slow frame does not postpone the other frame's placement request.
        const results = await Promise.allSettled(writes.map(({ record, placements }) =>
          this.#command(record, 'applyPlacements', { revision: ++record.revision, placements })));
        for (const [index, result] of results.entries()) {
          const { sourceId, record, snapshot } = writes[index];
          if (result.status === 'fulfilled') {
            record.snapshot = snapshot;
            this.#activity.layoutWrites += 1;
          } else {
            failed = true;
            const reason = result.reason.message;
            this.#blocked.set(sourceId, { context: record.context, reason });
            await this.#retire(sourceId, reason, true, true);
            this.#sourceStates.set(sourceId, { status: 'failed', reason });
          }
        }
        if (!failed) break;
      }
      if (this.#stopping || this.#page.disconnected) throw new Error('Coordinator stopped or transport disconnected.');
      this.#lastError = null;
    } catch (error) {
      this.#lastError = error.message;
      await this.#disconnect(error.message);
    }
    this.#activity.lastCycleMs = Math.max(0, this.#clock() - started);
    this.#activity.longestCycleMs = Math.max(this.#activity.longestCycleMs, this.#activity.lastCycleMs);
    for (const { resolve, result } of replies) resolve(result);
    return this.diagnostics();
  }

  stop() {
    if (this.#stopWork) return this.#stopWork;
    this.#stopping = true;
    for (const command of this.#controls.splice(0)) command.reject(new Error('Coordinator is stopped.'));
    this.#stopWork = (async () => {
      await this.#work;
      await this.#enhancement.stop();
      await this.#disconnect('teardown');
      for (const entry of this.compositor.entries()) if (entry.kind === 'spacer') this.compositor.removeSpacer(entry.spacerId);
      return this.diagnostics();
    })();
    return this.#stopWork;
  }
}
