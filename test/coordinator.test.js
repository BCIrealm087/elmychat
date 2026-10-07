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

test('failure between draining reports and applying layouts is latched and healthy geometry updates', async () => {
  const { page, runtime } = await attached();
  page.publish(1, 'added', 'a'); page.publish(2, 'added', 'b');
  const call = page.call.bind(page);
  page.call = async (context, platform, method, command) => {
    if (platform === 'youtube' && method === 'applyPlacements') return { accepted: false, reason: 'inactive' };
    return call(context, platform, method, command);
  };
  await runtime.step();
  assert.deepEqual(runtime.compositor.entries().map((e) => e.messageId), ['a']);
  const twitch = page.calls.filter((c) => c.method === 'applyPlacements' && c.platform === 'twitch').at(-1);
  assert.equal(twitch.command.placements[0].rect.y + 28, 600);
  assert.equal(runtime.diagnostics().sources[1].status, 'failed');
  const installs = page.installs;
  await runtime.step(); assert.equal(page.installs, installs);
  await runtime.stop();
});

test('loading documents wait and recover in the same context without latching or disrupting Twitch', async () => {
  const page = new Page();
  const context = page.frames[2].context;
  page.frames[2].documentReady = false;
  const runtime = new NativeCoordinator(config, { openPage: async () => page });
  for (let i = 0; i < 3; i += 1) await runtime.step();
  assert.equal(page.installs, 1);
  assert.equal(runtime.diagnostics().sources[0].status, 'running');
  assert.equal(runtime.diagnostics().sources[1].reason, 'native-document-loading');
  page.frames[2].documentReady = true;
  const install = page.install.bind(page);
  let raced = false;
  page.install = async (...args) => {
    if (!raced) { raced = true; return { installed: false, waitingForDocument: true }; }
    return install(...args);
  };
  await runtime.step();
  assert.equal(runtime.diagnostics().sources[1].status, 'waiting');
  assert.equal(runtime.compositor.sourceCount, 1);
  await runtime.step();
  assert.equal(runtime.diagnostics().sources[1].status, 'running');
  assert.equal(page.frames[2].context, context);
  assert.equal(runtime.compositor.sourceCount, 2);
  await runtime.stop();
});

test('live gap and spacers preserve message sequences, survive reconnect, and retire spacer-driven evictions', async () => {
  const { page, runtime } = await attached({ maxEntries: 3 });
  page.publish(1, 'added', 'a'); page.publish(2, 'added', 'b'); await runtime.step();
  const sequences = runtime.compositor.entries().map((entry) => entry.sequence);
  await runtime.control({ type: 'gap', height: 50.5 });
  let layout = runtime.compositor.layout();
  assert.equal(layout.placements[1].rect.y - layout.placements[0].rect.y - 28, 50.5);
  assert.deepEqual(runtime.compositor.entries().map((entry) => entry.sequence), sequences);
  const spacer = (await runtime.control({ type: 'spacer-add', height: 100 })).entry;
  assert.equal(runtime.compositor.layout().placements.at(-1).rect.y + 28, 500);
  await runtime.control({ type: 'spacer-update', spacerId: spacer.spacerId, height: 200 });
  assert.equal(runtime.compositor.layout().placements.at(-1).rect.y + 28, 400);
  const second = (await runtime.control({ type: 'spacer-add', height: 20 })).entry;
  assert.deepEqual(page.calls.filter((c) => c.method === 'retireMessages').at(-1).command.messageIds, ['a']);
  page.publish(1, 'added', 'c'); await runtime.step();
  layout = runtime.compositor.layout();
  assert.equal(layout.spacers.length, 2);
  await runtime.control({ type: 'spacer-remove', spacerId: second.spacerId });
  await assert.rejects(runtime.control({ type: 'spacer-update', spacerId: second.spacerId, height: 1 }), /no longer retained/);
  page.frames[1] = { ...page.frames[1], context: {} }; await runtime.step();
  assert.equal(runtime.compositor.layout().spacers[0].spacerId, spacer.spacerId);
  await runtime.stop();
});

test('controls queued during a cycle are drained without another timer and pending work rejects on stop', async () => {
  const { page, runtime } = await attached();
  const describe = page.describe.bind(page);
  let release; const gate = new Promise((done) => { release = done; });
  page.describe = async () => { await gate; return describe(); };
  const cycle = runtime.step();
  const control = runtime.control({ type: 'gap', height: 75 });
  release(); await cycle; await control;
  assert.equal(runtime.config.gap, 75);
  assert.throws(() => runtime.control({ type: 'gap', height: NaN }), /Spacing/);
  await runtime.stop();
  await assert.rejects(runtime.control({ type: 'gap', height: 0 }), /stopped/);
});

test('spacer and command limits are explicit and do not mutate accepted spacing', async () => {
  const { runtime } = await attached();
  for (let i = 0; i < 32; i += 1) await runtime.control({ type: 'spacer-add', height: i });
  await assert.rejects(runtime.control({ type: 'spacer-add', height: 1 }), /32 retained spacers/);
  assert.equal(runtime.compositor.layout().spacers.length, 32);
  await runtime.stop();
});

test('source query selection ignores parameter order but rejects a different video', async () => {
  const page = new Page();
  page.frames[2].url = 'https://youtube.test/chat?embed_domain=localhost&v=abcdefghijk';
  const selected = { ...config, sources: [config.sources[0], { ...config.sources[1], urlPrefix: 'https://youtube.test/chat?v=abcdefghijk' }] };
  const runtime = new NativeCoordinator(selected, { openPage: async () => page });
  await runtime.step(); assert.equal(runtime.diagnostics().sources[1].status, 'running');
  page.frames[2] = { ...page.frames[2], context: {}, url: 'https://youtube.test/chat?v=other-video' };
  await runtime.step(); assert.equal(runtime.diagnostics().sources[1].status, 'waiting');
  await runtime.stop();
});

test('sustained reports and repeated generations keep history, sessions and cleanup bounded; idle cycles do not write layouts', async () => {
  const { page, runtime } = await attached({ maxEntries: 64 });
  for (let batch = 0; batch < 240; batch += 1) {
    for (let i = 0; i < 100; i += 1) page.publish(i % 2 + 1, 'added', `${batch}:${i}`);
    await runtime.step();
    const state = runtime.diagnostics();
    assert.equal(state.resources.retainedEntries, 64);
    assert.equal(state.resources.activeSessions, 2);
    assert.ok(state.resources.cleanupEntries <= 16);
    assert.equal(state.resources.pendingControls, 0);
    assert.equal(state.layout.placements.at(-1).rect.y + 28, 600);
    if (batch % 8 === 7) {
      const prior = page.frames[1].context;
      page.frames[1] = { ...page.frames[1], context: {} };
      await runtime.step();
      page.sessions.delete(prior); page.buffers.delete(prior);
    }
    page.calls.length = 0;
  }
  const active = runtime.diagnostics();
  assert.equal(active.activity.reportsProcessed, 24000);
  assert.equal(active.activity.sessionsStarted, 32);
  assert.equal(active.cleanup.length, 16);
  active.cleanup[0].reason = 'external mutation'; active.cleanup.length = 0;
  assert.equal(runtime.diagnostics().cleanup.length, 16);
  assert.notEqual(runtime.diagnostics().cleanup[0].reason, 'external mutation');
  for (let i = 0; i < 120; i += 1) await runtime.step();
  const idle = runtime.diagnostics();
  assert.equal(idle.activity.layoutWrites, active.activity.layoutWrites);
  assert.equal(idle.activity.reportsProcessed, active.activity.reportsProcessed);
  assert.equal(idle.cycles, active.cycles + 120);
  assert.ok(Number.isFinite(idle.activity.longestCycleMs));
  const stopped = await runtime.stop();
  assert.equal(stopped.resources.retainedEntries, 0);
  assert.equal(stopped.resources.activeSessions, 0);
  assert.ok(stopped.cleanup.slice(-2).every((entry) => entry.restored));
});

test('spacing pressure rejects excess commands and shutdown settles every queued request', async () => {
  const { page, runtime } = await attached();
  let release; const gate = new Promise((done) => { release = done; });
  page.describe = async () => { await gate; return page.frames; };
  const cycle = runtime.step();
  const pending = Array.from({ length: 32 }, (_, height) => assert.rejects(runtime.control({ type: 'gap', height }), /stopped/));
  await assert.rejects(runtime.control({ type: 'gap', height: 100 }), /Too many pending/);
  assert.equal(runtime.diagnostics().resources.pendingControls, 32);
  const stop = runtime.stop(); release();
  await Promise.all([cycle, stop, ...pending]);
  assert.equal(runtime.diagnostics().resources.pendingControls, 0);
  assert.equal(runtime.config.gap, 12);
});
