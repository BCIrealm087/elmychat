import { randomUUID } from 'node:crypto';
import { Compositor } from '../../../packages/compositor/index.js';
import { requireLoopback } from '../../../packages/browser-control/cdp.js';
import { NativePage } from '../../../packages/browser-control/native-page.js';

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
  const sources = input.sources.map(({ id, platform, urlPrefix }) => {
    if (typeof id !== 'string' || !id.length || id.length > 512 || ids.has(id)) throw new Error('Source IDs must be unique nonempty strings.');
    if (!['twitch', 'youtube'].includes(platform) || platforms.has(platform)) throw new Error('Configure one source per supported platform.');
    if (typeof urlPrefix !== 'string') throw new Error('Source urlPrefix is required.');
    const url = new URL(urlPrefix);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash || url.pathname === '/') throw new Error('Source prefixes require an HTTP(S) chat path without credentials or hash.');
    ids.add(id); platforms.add(platform);
    return { id, platform, urlPrefix: url.href };
  });
  return { endpoint: input.endpoint, targetId: input.targetId, targetUrl: input.targetUrl, gap, maxEntries, intervalMs, sources };
}

function matches(url, prefix) {
  // Prefixes may restrict chat query parameters; origin equality prevents host
  // prefix lookalikes. A document navigation receives a new context generation.
  return new URL(url).origin === new URL(prefix).origin && url.startsWith(prefix);
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

  constructor(config, { openPage = NativePage.open, clock = () => performance.now() } = {}) {
    this.config = validateRuntimeConfig(config);
    this.compositor = new Compositor({ viewport: { width: 0, height: 0 }, gap: this.config.gap, maxEntries: this.config.maxEntries, maxSources: 2 });
    this.#open = openPage;
    this.#clock = clock;
  }

  diagnostics() {
    const sources = this.config.sources.map(({ id, platform }) => ({ id, platform, ...this.#sourceStates.get(id) }));
    return {
      status: this.#stopping ? 'stopped' : this.#lastError ? 'waiting' : this.#page ? 'connected' : 'waiting',
      targetId: this.#pinnedId ?? null, cycles: this.#cycles, lastError: this.#lastError,
      chatConnected: !this.#stopping && !this.#page?.disconnected && sources.every((source) => source.status === 'running'),
      sources, layout: this.compositor.layout(), cleanup: this.#cleanup,
    };
  }

  step() {
    if (this.#stopping) return Promise.resolve(this.diagnostics());
    if (this.#work) return this.#work;
    this.#work = this.#cycle().finally(() => { this.#work = undefined; });
    return this.#work;
  }

  async #retire(id, reason, restore = true) {
    const record = this.#records.get(id);
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
    this.#cycles += 1;
    try {
      if (this.#page?.disconnected) await this.#disconnect('transport-disconnected');
      if (!this.#page) {
        this.#page = await this.#open(this.config, this.#pinnedId);
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
      const matched = this.config.sources.map((source) => frames.filter((frame) => !frame.topLevel && matches(frame.url, source.urlPrefix)));
      if (matched[0].some((first) => matched[1].some((second) => first.context === second.context))) throw new Error('Source prefixes overlap on the same frame.');
      const retired = new Map();
      for (const source of this.config.sources) {
        if (this.#stopping || this.#page.disconnected) throw new Error('Coordinator stopped or transport disconnected.');
        const candidates = frames.filter((frame) => !frame.topLevel && matches(frame.url, source.urlPrefix));
        let record = this.#records.get(source.id);
        if (candidates.length !== 1 || (record && candidates[0].context !== record.context)) {
          await this.#retire(source.id, candidates.length > 1 ? 'ambiguous-source-frame' : 'frame-replaced-or-missing');
          record = undefined;
        }
        if (candidates.length !== 1) continue;
        const { context } = candidates[0];
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
            await this.#page.install(context, source.platform, { sourceId: source.id, sessionId: record.sessionId, width: record.width, maxRoots: 500, maxReports: 1000 }, this.#owner);
            if (this.#stopping || this.#page.disconnected) throw new Error('Transport changed during installation.');
            this.compositor.activateSource(source.id, record.sessionId);
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
            for (const entry of result.removed ?? []) if (entry.reason === 'history-limit' && entry.kind === 'message') {
              const ids = retired.get(entry.sourceId) ?? new Set();
              ids.add(entry.messageId); retired.set(entry.sourceId, ids);
            }
          }
          this.#sourceStates.set(source.id, {
            status: batch.diagnostics?.waitingForContainer ? 'waiting' : 'running',
            sessionId: record.sessionId, waitingForContainer: batch.diagnostics?.waitingForContainer ?? false,
            trackedRoots: batch.diagnostics?.trackedRoots ?? null,
          });
        } catch (error) {
          this.#blocked.set(source.id, { context, reason: error.message });
          await this.#retire(source.id, error.message);
          this.#sourceStates.set(source.id, { status: 'failed', reason: error.message });
        }
      }
      for (const [sourceId, ids] of retired) {
        const record = this.#records.get(sourceId);
        if (record) await this.#command(record, 'retireMessages', { messageIds: [...ids] });
      }
      const layout = this.compositor.layout();
      for (const [sourceId, record] of this.#records) {
        const placements = layout.placements.filter((entry) => entry.sourceId === sourceId && entry.sessionId === record.sessionId);
        const snapshot = JSON.stringify(placements);
        if (snapshot !== record.snapshot) {
          await this.#command(record, 'applyPlacements', { revision: ++record.revision, placements });
          record.snapshot = snapshot;
        }
      }
      this.#lastError = null;
    } catch (error) {
      this.#lastError = error.message;
      await this.#disconnect(error.message);
    }
    return this.diagnostics();
  }

  stop() {
    if (this.#stopWork) return this.#stopWork;
    this.#stopping = true;
    this.#stopWork = (async () => { await this.#work; await this.#disconnect('teardown'); return this.diagnostics(); })();
    return this.#stopWork;
  }
}
