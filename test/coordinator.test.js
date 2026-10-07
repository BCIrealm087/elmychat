import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NativeCoordinator, validateRuntimeConfig } from '../apps/coordinator/src/runtime.js';

const config = {
  endpoint: 'http://127.0.0.1:9222', targetUrl: 'http://127.0.0.1:3210/native', gap: 12,
  sources: [
    { id: 't', platform: 'twitch', urlPrefix: 'https://twitch.test/chat' },
    { id: 'y', platform: 'youtube', urlPrefix: 'https://youtube.test/chat' },
  ],
};
class Page {
  target = { id: 'selected', url: config.targetUrl };
  disconnected = false;
  frames = [
    { context: {}, topLevel: true, url: config.targetUrl, width: 420, height: 600 },
    ...config.sources.map((source) => ({ context: {}, topLevel: false, url: source.urlPrefix, width: 420, height: 600 })),
  ];
  calls = [];
  sessions = new Map();
  buffers = new Map();
  failure = new Map();
  installs = 0;
  async describe() { return this.frames; }
  has(context) { return this.frames.some((frame) => frame.context === context); }
  async install(context, platform, options) {
    this.installs += 1;
    this.sessions.set(context, options);
    this.buffers.set(context, []);
    return { installed: true };
  }
  publish(index, type, messageId, dimensions = {}) {
    const context = this.frames[index].context;
    const session = this.sessions.get(context);
    this.buffers.get(context).push({ type, sourceId: session.sourceId, sessionId: session.sessionId, messageId, width: session.width, height: 28, ...dimensions });
  }
  async call(context, platform, method, command) {
    this.calls.push({ context, platform, method, command });
    if (method === 'stop') return { accepted: true, restored: true };
    if (method === 'takeReports') {
      const events = this.buffers.get(context).splice(0);
      return { accepted: true, status: this.failure.has(context) ? 'failed' : 'running', failure: this.failure.get(context), events };
    }
    return { accepted: true };
  }
  close() { this.disconnected = true; }
}
async function attached(options = {}) {
  const page = new Page();
  const runtime = new NativeCoordinator({ ...config, ...options }, { openPage: async () => page, clock: () => 10 });
  await runtime.step();
  return { page, runtime };
}

test('coordinator validates bounds and explicit scoped endpoints', () => {
  assert.equal(validateRuntimeConfig(config).intervalMs, 100);
  for (const changed of [{ endpoint: 'http://192.168.1.2:9222' }, { targetUrl: 'https://other.test/' }, { gap: -1 }, { maxEntries: 501 }, { intervalMs: 0 }, { sources: [config.sources[0]] }, { sources: [config.sources[0], config.sources[0]] }, { sources: [{ ...config.sources[0], urlPrefix: 'https://twitch.test/' }, config.sources[1]] }]) assert.throws(() => validateRuntimeConfig({ ...config, ...changed }));
});

test('report admission, delayed resize, stale generations and full snapshot removal', async () => {
  const { page, runtime } = await attached();
  page.publish(1, 'added', 'a'); page.publish(2, 'added', 'b', { height: 40 });
  await runtime.step();
  const entries = runtime.compositor.entries();
  assert.deepEqual(entries.map((e) => e.messageId), ['a', 'b']);
  const layout = runtime.compositor.layout();
  assert.equal(layout.placements[1].rect.y - layout.placements[0].rect.y - 28, 12);
  assert.equal(layout.placements[1].rect.y + 40, 600);
  page.publish(1, 'resized', 'a', { height: 50 });
  page.publish(1, 'added', 'stale', { sessionId: 'obsolete' });
  await runtime.step();
  assert.equal(runtime.compositor.entries()[0].sequence, entries[0].sequence);
  assert.equal(runtime.compositor.entries()[0].height, 50);
  page.publish(1, 'removed', 'a'); await runtime.step();
  assert.deepEqual(runtime.compositor.entries().map((e) => e.messageId), ['b']);
  assert.deepEqual(page.calls.filter((c) => c.method === 'applyPlacements' && c.platform === 'twitch').at(-1).command.placements, []);
  assert.equal((await runtime.stop()).cleanup.every((c) => c.restored), true);
});

test('history evictions return to the owning adapters and unchanged cycles do not send layouts', async () => {
  const { page, runtime } = await attached({ maxEntries: 2 });
  page.publish(1, 'added', 'a'); page.publish(1, 'added', 'b'); page.publish(2, 'added', 'c');
  await runtime.step();
  assert.deepEqual(runtime.compositor.entries().map((e) => e.messageId), ['b', 'c']);
  assert.deepEqual(page.calls.find((c) => c.method === 'retireMessages').command.messageIds, ['a']);
  const writes = page.calls.filter((c) => c.method === 'applyPlacements').length;
  await runtime.step();
  assert.equal(page.calls.filter((c) => c.method === 'applyPlacements').length, writes);
  await runtime.stop();
});

test('viewport changes hide stale measurements and remeasurement restores visibility', async () => {
  const { page, runtime } = await attached();
  page.publish(1, 'added', 'a'); await runtime.step();
  page.frames[0].width = 300; page.frames[0].height = 400;
  await runtime.step();
  assert.equal(runtime.compositor.layout().placements[0].visible, false);
  assert.equal(page.calls.filter((c) => c.method === 'setWidth').length, 2);
  page.publish(1, 'resized', 'a', { width: 300, height: 70 }); await runtime.step();
  assert.equal(runtime.compositor.layout().placements[0].rect.y, 330);
  assert.equal(runtime.compositor.layout().placements[0].visible, true);
  page.frames[0].width = 0; await runtime.step();
  assert.equal(runtime.compositor.layout().placements[0].visible, false);
  await runtime.stop();
});

test('frame replacement retires old identities; ambiguous frames restore without taking either over', async () => {
  const { page, runtime } = await attached();
  page.publish(1, 'added', 'a'); await runtime.step();
  const oldSession = runtime.diagnostics().sources[0].sessionId;
  page.frames[1] = { ...page.frames[1], context: {} };
  await runtime.step();
  assert.notEqual(runtime.diagnostics().sources[0].sessionId, oldSession);
  assert.equal(runtime.compositor.entries().length, 0);
  page.frames.push({ ...page.frames[1], context: {} });
  await runtime.step();
  assert.equal(runtime.diagnostics().sources[0].reason, 'ambiguous-source-frame');
  const installs = page.installs;
  await runtime.step(); assert.equal(page.installs, installs);
  page.frames.pop(); await runtime.step();
  assert.equal(runtime.diagnostics().sources[0].status, 'running');
  await runtime.stop();
});

test('failed source is latched until context replacement, while healthy source continues', async () => {
  const { page, runtime } = await attached();
  page.publish(1, 'added', 'a'); page.publish(2, 'added', 'b'); await runtime.step();
  page.failure.set(page.frames[1].context, 'root-overflow'); await runtime.step();
  assert.deepEqual(runtime.compositor.entries().map((e) => e.messageId), ['b']);
  assert.equal(runtime.diagnostics().sources[0].status, 'failed');
  const installs = page.installs;
  await runtime.step(); assert.equal(page.installs, installs);
  page.frames[1] = { ...page.frames[1], context: {} }; await runtime.step();
  assert.equal(runtime.diagnostics().sources[0].status, 'running');
  await runtime.stop();
});

test('disconnect pins reconnection to the selected ID and assigns fresh sessions', async () => {
  const first = new Page(); const second = new Page(); const pins = [];
  const runtime = new NativeCoordinator(config, { openPage: async (_, pin) => { pins.push(pin); return pins.length === 1 ? first : second; } });
  await runtime.step(); first.publish(1, 'added', 'a'); await runtime.step();
  const old = runtime.diagnostics().sources[0].sessionId;
  first.disconnected = true; await runtime.step();
  assert.deepEqual(pins, [undefined, 'selected']);
  assert.equal(runtime.compositor.entries().length, 0);
  assert.notEqual(runtime.diagnostics().sources[0].sessionId, old);
  assert.equal(runtime.diagnostics().cleanup.some((c) => !c.restored), true);
  second.frames[0].url = 'http://127.0.0.1:3210/unrelated'; await runtime.step();
  assert.match(runtime.diagnostics().lastError, /original exact URL/);
  assert.equal(runtime.compositor.entries().length, 0);
  await runtime.stop();
});

test('overlapping ticks coalesce and shutdown waits for an in-flight installation before restoring', async () => {
  const page = new Page();
  let release; const gate = new Promise((resolve) => { release = resolve; });
  const install = page.install.bind(page);
  let started; const entered = new Promise((resolve) => { started = resolve; });
  page.install = async (...args) => { await install(...args); started(); await gate; return { installed: true }; };
  const runtime = new NativeCoordinator(config, { openPage: async () => page });
  const first = runtime.step(); assert.equal(runtime.step(), first);
  await entered;
  const stopped = runtime.stop(); release(); await first; await stopped;
  assert.equal(page.installs, 1);
  assert.equal(page.calls.filter((c) => c.method === 'stop').length, 1);
  assert.equal(page.calls.filter((c) => c.method === 'applyPlacements').length, 0);
  assert.equal(runtime.diagnostics().status, 'stopped');
  assert.equal(page.disconnected, true);
});
