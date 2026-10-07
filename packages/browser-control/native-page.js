import { CdpConnection, FrameContexts, discover, selectTarget } from './cdp.js';
import { adapterKey as twitchKey, twitchAdapterExpression } from '../adapters/twitch/index.js';
import { adapterKey as youtubeKey, youtubeAdapterExpression } from '../adapters/youtube/index.js';

const adapters = {
  twitch: { key: twitchKey, expression: twitchAdapterExpression },
  youtube: { key: youtubeKey, expression: youtubeAdapterExpression },
};
const methods = new Set(['takeReports', 'setWidth', 'applyPlacements', 'retireMessages', 'stop']);

/** Access only the explicitly selected page and its default iframe worlds. */
export class NativePage {
  disconnected = false;
  constructor(connection, frames, target) {
    this.connection = connection;
    this.frames = frames;
    this.target = target;
    connection.once('disconnected', () => { this.disconnected = true; });
  }

  static async open(config, pinnedId) {
    const { targets } = await discover(config.endpoint);
    const target = selectTarget(targets, pinnedId ? { targetId: pinnedId } : config);
    const connection = await CdpConnection.connect(target.webSocketDebuggerUrl);
    const frames = new FrameContexts(connection);
    const page = new NativePage(connection, frames, target);
    try { await frames.start(); return page; }
    catch (error) { page.close(); throw error; }
  }

  has(context) { return [...this.frames.contexts.values()].includes(context); }

  async describe() {
    await this.frames.settle();
    if (this.frames.errors.length) throw new Error(`Frame attachment failed: ${this.frames.errors.at(-1)}`);
    const contexts = [...this.frames.contexts.values()];
    if (contexts.length > 32) throw new Error('Selected page exceeds 32 default frame contexts.');
    // Serial evaluation bounds pending commands even under nested OOPIF load.
    const result = [];
    for (const context of contexts) {
      try {
        const info = await this.frames.evaluate(context, '({url:location.href,topLevel:window===top,width:innerWidth,height:innerHeight})');
        result.push({ context, ...info });
      } catch (error) { if (this.has(context)) throw error; }
    }
    return result;
  }

  async install(context, platform, options, owner) {
    const adapter = adapters[platform];
    if (!adapter) throw new Error('Unsupported adapter.');
    const existing = await this.frames.evaluate(context, `globalThis[${JSON.stringify(adapter.key)}]?.diagnostics() ?? null`);
    if (existing?.status === 'running') {
      // Recover only this process's adapter after a lost socket. Never take over
      // another coordinator/probe's live adapter.
      if (!existing.sessionId.startsWith(`${owner}:`)) throw new Error('Frame already has an adapter owned by another coordinator.');
      const stopped = await this.call(context, platform, 'stop', existing);
      if (!stopped?.restored) throw new Error('Previous adapter could not restore styles.');
    }
    const result = await this.frames.evaluate(context, adapter.expression(options));
    if (!result?.installed) throw new Error('Adapter installation did not complete.');
    return result;
  }

  call(context, platform, method, command) {
    if (!adapters[platform] || !methods.has(method)) throw new Error('Unsupported adapter command.');
    if (method === 'stop') return this.frames.evaluate(context, `(() => { const api = globalThis[${JSON.stringify(adapters[platform].key)}]; if (!api) return null; const state = api.diagnostics(); if (state.sourceId === ${JSON.stringify(command.sourceId)} && state.sessionId === ${JSON.stringify(command.sessionId)} && state.status !== 'running' && state.styledNodes === 0) return { accepted: true, restored: true, reason: 'already-terminated' }; return api.stop(${JSON.stringify(command)}); })()`);
    if (method === 'takeReports') return this.frames.evaluate(context, `(() => { const api = globalThis[${JSON.stringify(adapters[platform].key)}]; return api ? { ...api.takeReports(${JSON.stringify(command)}), diagnostics: api.diagnostics() } : null; })()`);
    return this.frames.evaluate(context, `globalThis[${JSON.stringify(adapters[platform].key)}]?.[${JSON.stringify(method)}](${JSON.stringify(command)}) ?? null`);
  }

  close() { this.frames.stop(); this.connection.close(); this.disconnected = true; }
}
