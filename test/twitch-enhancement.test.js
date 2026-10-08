import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import vm from 'node:vm';
import { enhancementExpression } from '../packages/adapters/twitch/enhancement.js';
import { TwitchEnhancement } from '../apps/coordinator/src/twitch-enhancement.js';
import { validateRuntimeConfig } from '../apps/coordinator/src/runtime.js';

const choices = { sevenTv: true, betterTtv: true };
const bootstrap = { integrity: `sha256-${'a'.repeat(43)}=` };
const url = 'https://www.twitch.tv/embed/fixture/chat';
const status = (value, resetRequired = true) => ({ status: value, resetRequired, reason: null, providers: [], engineVersion: 'fixture' });
const record = sessionId => ({ context: {}, sessionId });
const page = () => ({ disconnected: false, has: () => true });
async function until(predicate) {
  for (let i = 0; i < 200; i += 1) { if (predicate()) return; await delay(5); }
  assert.fail('Lifecycle did not converge.');
}

test('enhancement config is explicit, defaults off and rejects non-Twitch targets/providers', () => {
  const config = { endpoint: 'http://127.0.0.1:9222', targetUrl: 'http://127.0.0.1:3210/overlay', sources: [
    { id: 't', platform: 'twitch', urlPrefix: url }, { id: 'y', platform: 'youtube', urlPrefix: 'https://www.youtube.com/live_chat?v=fixture' },
  ] };
  assert.deepEqual(validateRuntimeConfig(config).sources[0].emotes, { sevenTv: false, betterTtv: false });
  for (const emotes of [null, [], { sevenTv: 1 }, { other: true }]) {
    assert.throws(() => validateRuntimeConfig({ ...config, sources: [{ ...config.sources[0], emotes }, config.sources[1]] }));
  }
  assert.throws(() => validateRuntimeConfig({ ...config, sources: [config.sources[0], { ...config.sources[1], emotes: choices }] }), /Twitch-only/);
  for (const urlPrefix of ['https://twitch.test/chat', 'https://www.twitch.tv/embed/fixture/chat/else', 'https://www.twitch.tv:444/embed/fixture/chat']) {
    assert.throws(() => validateRuntimeConfig({ ...config, sources: [{ ...config.sources[0], urlPrefix, emotes: choices }, config.sources[1]] }), /native Twitch embed/);
  }
});

test('delayed readiness and empty data do not duplicate begin; status copies cannot mutate lifecycle', async () => {
  const calls = []; let ready = false;
  const lifecycle = new TwitchEnhancement(choices, 'owner', { download: async () => bootstrap, pollMs: 5,
    evaluate: async (_, command) => { calls.push(command.operation); return command.operation === 'inspect' ? null : status(ready ? 'ready' : 'loading'); } });
  const p = page(), r = record('first');
  for (let i = 0; i < 30; i += 1) lifecycle.sync(p, r, url);
  await until(() => calls.filter(call => call === 'poll').length >= 2);
  assert.equal(calls.filter(call => call === 'begin').length, 1);
  ready = true; await until(() => lifecycle.diagnostics().status === 'ready');
  const snapshot = lifecycle.diagnostics(); snapshot.providers.push({ id: 'foreign' });
  assert.deepEqual(lifecycle.diagnostics().providers, []);
  for (let i = 0; i < 100; i += 1) lifecycle.sync(p, r, url);
  assert.equal(calls.filter(call => call === 'begin').length, 1);
  await lifecycle.stop();
});

test('two bounded download failures latch without injecting or refreshing native chat', async () => {
  let downloads = 0; const calls = [];
  const lifecycle = new TwitchEnhancement(choices, 'owner', { retryMs: 1,
    download: async () => { downloads += 1; throw new Error('CDN unavailable'); },
    evaluate: async (_, command) => { calls.push(command.operation); return null; } });
  const p = page(), r = record('first'); lifecycle.sync(p, r, url);
  await until(() => lifecycle.diagnostics().status === 'unavailable');
  for (let i = 0; i < 200; i += 1) lifecycle.sync(p, r, url);
  assert.equal(downloads, 2); assert.deepEqual(calls, ['inspect']);
  assert.equal(lifecycle.diagnostics().resetRequested, false);
  await lifecycle.stop();
});

test('old downloads and command callbacks cannot inject or publish into a replacement generation', async () => {
  let release; let downloads = 0; const calls = [];
  const lifecycle = new TwitchEnhancement(choices, 'owner', {
    download: async () => { downloads += 1; if (downloads === 1) return new Promise(resolve => { release = resolve; }); return bootstrap; },
    evaluate: async (_, command) => { calls.push(command); return command.operation === 'inspect' ? null : status('ready'); } });
  const p = page(), first = record('old'), second = record('new'); lifecycle.sync(p, first, url);
  const changedUrl = 'https://www.twitch.tv/embed/another/chat';
  await until(() => !!release); lifecycle.sync(p, second, changedUrl); release(bootstrap);
  await until(() => lifecycle.diagnostics().status === 'ready');
  assert.deepEqual(calls.filter(call => call.operation === 'begin').map(call => call.sessionId), ['new']);
  assert.equal(calls.find(call => call.operation === 'begin').documentUrl, changedUrl);
  await lifecycle.stop();

  let releaseBegin; const later = [];
  const pending = new TwitchEnhancement(choices, 'owner', { download: async () => bootstrap,
    evaluate: async (_, command) => { later.push(command); if (command.operation === 'inspect') return null;
      if (command.operation === 'begin' && command.sessionId === 'old') return new Promise(resolve => { releaseBegin = resolve; });
      return status(command.sessionId === 'old' ? 'unavailable' : 'ready'); } });
  pending.sync(p, first, url); await until(() => !!releaseBegin);
  pending.sync(p, second, url); releaseBegin(status('unavailable'));
  await until(() => pending.diagnostics().status === 'ready');
  assert.equal(later.some(call => call.operation === 'reset'), false);
  assert.ok(later.some(call => call.operation === 'stop' && call.sessionId === 'old'));
  await pending.stop();
});

test('partial initialization and readiness timeout get one reset, then pause enhancement through replacement', async () => {
  for (const failure of ['partial', 'timeout', 'reset-refused']) {
    const calls = [];
    const lifecycle = new TwitchEnhancement(choices, 'owner', { download: async () => bootstrap, timeoutMs: 15, pollMs: 2,
      evaluate: async (_, command) => { calls.push(command.operation); if (command.operation === 'inspect') return null;
        if (command.operation === 'reset') { if (failure === 'reset-refused') throw new Error('ownership changed'); return { resetRequested: true }; }
        return status(failure === 'partial' || command.operation === 'stop' ? 'unavailable' : 'loading'); } });
    const p = page(); lifecycle.sync(p, record('first'), url);
    await until(() => calls.includes('reset'));
    for (let i = 0; i < 20; i += 1) lifecycle.sync(p, record(`replacement-${i}`), url);
    await delay(10);
    assert.equal(calls.filter(call => call === 'begin').length, 1);
    assert.equal(calls.filter(call => call === 'reset').length, 1);
    assert.equal(lifecycle.diagnostics().status, 'unavailable');
    assert.equal(lifecycle.diagnostics().resetRequested, failure !== 'reset-refused');
    assert.equal(lifecycle.diagnostics().resetAttempted, true);
    await lifecycle.stop();
  }
});

test('same-process reconnect adopts owned hooks; foreign ownership is left untouched', async () => {
  let marker; let installs = 0;
  const driver = async (_, command) => {
    if (command.operation === 'inspect') return marker ? { owned: marker.owner === command.owner } : null;
    if (command.operation === 'begin') { if (!marker) { installs += 1; marker = { owner: command.owner }; } return status('ready'); }
    return status('unavailable');
  };
  const lifecycle = new TwitchEnhancement(choices, 'owner', { download: async () => bootstrap, evaluate: driver });
  const first = page(); lifecycle.sync(first, record('first'), url);
  await until(() => lifecycle.diagnostics().status === 'ready' && !lifecycle.diagnostics().activeWork);
  first.disconnected = true; lifecycle.detach(); lifecycle.sync(page(), record('reconnected'), url);
  await until(() => lifecycle.diagnostics().status === 'ready' && !lifecycle.diagnostics().activeWork);
  assert.equal(installs, 1); await lifecycle.stop();
  const foreign = new TwitchEnhancement(choices, 'someone-else', { download: async () => { assert.fail('Must not download over a foreign instance'); }, evaluate: driver });
  foreign.sync(page(), record('foreign'), url); await until(() => foreign.diagnostics().status === 'unavailable');
  assert.equal(installs, 1); assert.equal(foreign.diagnostics().resetRequested, false); await foreign.stop();
});

test('stopping while download is pending aborts it and never begins a loader', async () => {
  let started = false; const calls = [];
  const lifecycle = new TwitchEnhancement(choices, 'owner', {
    download: signal => new Promise((_, reject) => { started = true; signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }),
    evaluate: async (_, command) => { calls.push(command.operation); return null; } });
  lifecycle.sync(page(), record('first'), url); await until(() => started); await lifecycle.stop();
  assert.deepEqual(calls, ['inspect']); assert.equal(lifecycle.diagnostics().activeWork, false);
});

test('native failure before a readiness poll schedules owned recovery without waiting on native cycles', async () => {
  const calls = [];
  const lifecycle = new TwitchEnhancement(choices, 'owner', { download: async () => bootstrap,
    evaluate: async (_, command) => { calls.push(command.operation); if (command.operation === 'inspect') return null;
      if (command.operation === 'reset') return { resetRequested: true };
      return status(command.operation === 'stop' ? 'unavailable' : 'ready'); } });
  lifecycle.sync(page(), record('native-failure'), url);
  await until(() => lifecycle.diagnostics().status === 'ready' && !lifecycle.diagnostics().activeWork);
  lifecycle.detach(true); await until(() => calls.includes('reset'));
  lifecycle.sync(page(), record('recovered-native'), url);
  assert.equal(lifecycle.diagnostics().status, 'unavailable');
  assert.equal(calls.filter(call => call === 'begin').length, 1);
  await lifecycle.stop();
});

test('pre-install readiness names the failing guard without creating hooks or accepting a stale URL/session', () => {
  const command = { operation: 'begin', owner: 'owner', sessionId: 'owner:first', documentUrl: url, emotes: choices };
  const cases = [
    { href: `${url}?changed`, body: {}, head: {}, adapter: { status: 'running', sessionId: command.sessionId }, reason: /URL changed/ },
    { href: url, body: {}, head: null, adapter: { status: 'running', sessionId: command.sessionId }, reason: /document/ },
    { href: url, body: {}, head: {}, adapter: null, reason: /adapter/ },
    { href: url, body: {}, head: {}, adapter: { status: 'running', sessionId: 'foreign' }, reason: /session/ },
  ];
  for (const fixture of cases) {
    const context = { location: { href: fixture.href }, document: { body: fixture.body, head: fixture.head },
      __elmychatTwitchAdapterV1: { diagnostics: () => fixture.adapter } };
    const result = vm.runInNewContext(enhancementExpression(command), context);
    assert.equal(result.awaitingNative, true); assert.equal(result.resetRequired, false);
    assert.match(result.reason, fixture.reason);
    assert.equal(context.__elmychatTwitchEnhancementV1, undefined);
  }
});

test('Apply waits for a fresh exact URL and native readiness after download, with one installation and no reset', async () => {
  let release; let currentUrl = url; let nativeReady = true; let installs = 0; let downloads = 0;
  const calls = [];
  const lifecycle = new TwitchEnhancement(choices, 'owner', { pollMs: 2,
    download: async () => { downloads += 1; return new Promise(resolve => { release = resolve; }); },
    evaluate: async (_, command) => {
      calls.push(command);
      if (command.operation === 'inspect') return null;
      if (command.operation === 'begin') {
        if (command.documentUrl !== currentUrl || !nativeReady) return { ...status('loading', false), awaitingNative: true, reason: 'Waiting for the selected native Twitch session.' };
        installs += 1; return status('ready');
      }
      return status('unavailable');
    } });
  const p = page(), r = record('first'); lifecycle.sync(p, r, url);
  await until(() => !!release);
  currentUrl = `${url}?fresh`; release(bootstrap);
  await until(() => lifecycle.diagnostics().awaitingNative === true);
  assert.equal(installs, 0);
  nativeReady = false; lifecycle.sync(p, r, currentUrl);
  await until(() => calls.some(command => command.operation === 'begin' && command.documentUrl === currentUrl));
  assert.equal(installs, 0); nativeReady = true;
  await until(() => lifecycle.diagnostics().status === 'ready' && !lifecycle.diagnostics().activeWork);
  assert.equal(installs, 1); assert.equal(downloads, 1);
  assert.equal(calls.some(command => ['reset', 'poll'].includes(command.operation)), false);
  await lifecycle.stop();
});

test('pre-install waiting expires without reset and stops promptly without a second begin', async () => {
  for (const cancel of [false, true]) {
    const calls = [];
    const lifecycle = new TwitchEnhancement(choices, 'owner', { download: async () => bootstrap, pollMs: cancel ? 500 : 2, timeoutMs: 15,
      evaluate: async (_, command) => {
        calls.push(command.operation);
        return command.operation === 'inspect' ? null : { ...status('loading', false), awaitingNative: true, reason: 'Waiting for the Twitch document.' };
      } });
    lifecycle.sync(page(), record('first'), url);
    await until(() => lifecycle.diagnostics().awaitingNative === true);
    if (cancel) await lifecycle.stop();
    else {
      await until(() => lifecycle.diagnostics().status === 'unavailable');
      assert.match(lifecycle.diagnostics().reason, /preparation timed out.*Twitch document/);
      await lifecycle.stop();
    }
    assert.equal(calls.some(operation => ['stop', 'poll', 'reset'].includes(operation)), false);
    if (cancel) assert.equal(calls.filter(operation => operation === 'begin').length, 1);
    assert.equal(lifecycle.diagnostics().resetAttempted, false);
  }
});
