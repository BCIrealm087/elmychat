import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { OperatorController, normalizeOperatorConfig, operatorRuntimeConfig, sourceUrls } from '../apps/coordinator/src/operator.js';
import { NativeCoordinator } from '../apps/coordinator/src/runtime.js';
import { createCoordinatorServer } from '../apps/coordinator/src/server.js';

const settings = { channel: 'Example_Channel', videoId: 'https://www.youtube.com/watch?v=abcdefghijk&t=10', debugPort: 9222, gap: 12 };
const factory = (config) => new NativeCoordinator(config, { openPage: async () => { throw new Error('Synthetic OBS endpoint offline.'); } });
async function controller(t, options = {}) {
  const folder = await mkdtemp(join(tmpdir(), 'elmychat-operator-'));
  const statePath = join(folder, 'operator.json');
  const operator = new OperatorController({ statePath, createRuntime: factory, ...options });
  t.after(async () => { await operator.close(); await rm(folder, { recursive: true, force: true }); });
  return { operator, statePath };
}

test('incomplete HTTP controls are bounded while health remains readable and completed requests release capacity', { timeout: 15000 }, async (t) => {
  const { operator } = await controller(t);
  const server = createCoordinatorServer({ operator, health: () => operator.health() });
  const pending = [];
  t.after(async () => { for (const request of pending) request.destroy(); server.closeAllConnections(); await new Promise((done) => server.close(done)); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(`${base}/api/state`)).json();
  const headers = { Origin: base, 'X-Elmychat-Token': token, 'Content-Type': 'application/json' };
  const replies = [];
  for (let i = 0; i < 16; i += 1) {
    const request = httpRequest(`${base}/api/connect`, { method: 'POST', headers: { ...headers, Expect: '100-continue' } });
    request.on('error', () => {}); pending.push(request);
    replies.push(new Promise((done) => request.on('response', (response) => { response.resume(); response.on('end', () => done(response.statusCode)); })));
    const ready = once(request, 'continue'); request.flushHeaders(); await ready;
    request.write('{');
  }
  const rejected = await fetch(`${base}/api/connect`, { method: 'POST', headers, body: '{}' });
  assert.equal(rejected.status, 503); await rejected.text();
  assert.equal((await (await fetch(`${base}/health`)).json()).status, 'idle');
  assert.equal(operator.state().configured, false);
  for (const request of pending) request.end('}');
  assert.ok((await Promise.all(replies)).every((status) => status === 409));
  const accepted = await fetch(`${base}/api/config`, { method: 'POST', headers, body: JSON.stringify(settings) });
  assert.equal(accepted.status, 200); await accepted.json();
  assert.equal(operator.state().config.channel, 'example_channel');
});

test('operator settings normalize video links and constrain source identity and connection limits', () => {
  const config = normalizeOperatorConfig(settings);
  assert.equal(config.channel, 'example_channel'); assert.equal(config.videoId, 'abcdefghijk');
  for (const videoId of ['abcdefghijk', 'https://youtu.be/abcdefghijk', 'https://youtube.com/live/abcdefghijk']) assert.equal(normalizeOperatorConfig({ ...settings, videoId }).videoId, 'abcdefghijk');
  for (const change of [{ channel: '<script>' }, { channel: 'has space' }, { videoId: 'https://youtube.com.evil/watch?v=abcdefghijk' }, { videoId: 'https://user@youtube.com/watch?v=abcdefghijk' }, { videoId: 'http://youtu.be/abcdefghijk' }, { videoId: 'https://youtube.com/playlist?list=abcdefghijk' }, { gap: -1 }, { debugPort: 0 }, { debugPort: 9222.5 }, { targetId: false }]) assert.throws(() => normalizeOperatorConfig({ ...settings, ...change }));
  const runtime = operatorRuntimeConfig(config, 'http://127.0.0.1:3210/overlay');
  assert.equal(runtime.sources[1].urlPrefix, 'https://www.youtube.com/live_chat?v=abcdefghijk');
  assert.match(sourceUrls(config)[0].url, /embed\/example_channel\/chat\?parent=127.0.0.1$/);
});

test('saved sources, gap and enabled state reload, while inserted spacers belong to the current run', async (t) => {
  const { operator, statePath } = await controller(t);
  await operator.load(); assert.equal(operator.state().configured, false);
  await operator.configure(settings);
  await operator.spacing({ type: 'gap', height: 64.5 });
  await operator.spacing({ type: 'spacer-add', height: 120 });
  const saved = JSON.parse(await readFile(statePath, 'utf8'));
  assert.equal(saved.enabled, true); assert.equal(saved.config.gap, 64.5);
  assert.equal(saved.spacers, undefined);
  await operator.close();
  assert.equal(operator.state().spacers.length, 0);
  const reloaded = new OperatorController({ statePath, createRuntime: factory });
  t.after(() => reloaded.close()); await reloaded.load();
  assert.equal(reloaded.state().enabled, true); assert.equal(reloaded.state().gap, 64.5); assert.equal(reloaded.state().spacers.length, 0);
  await reloaded.spacing({ type: 'spacer-add', height: 80 });
  assert.equal(reloaded.state().spacers.length, 1);
  await reloaded.disconnect();
  assert.equal(reloaded.state().spacers.length, 0);
  const disabled = new OperatorController({ statePath, createRuntime: factory });
  t.after(() => disabled.close()); await disabled.load();
  assert.equal(disabled.state().enabled, false);
  await disabled.connect(); assert.equal(disabled.state().enabled, true);
});

test('persistence failures preserve a working config and roll back a live gap change', async (t) => {
  let fail = false;
  const { operator } = await controller(t, { save: async () => { if (fail) throw new Error('Disk is full.'); } });
  await operator.configure(settings); fail = true;
  await assert.rejects(operator.configure({ ...settings, channel: 'other' }), /Disk is full/);
  assert.equal(operator.state().config.channel, 'example_channel');
  await assert.rejects(operator.spacing({ type: 'gap', height: 99 }), /Disk is full/);
  assert.equal(operator.state().gap, 12);
});

test('source replacement restores the previous runtime and matching-target discovery excludes unrelated pages', async (t) => {
  const runtimes = [];
  const overlayUrl = 'http://127.0.0.1:3210/overlay';
  const { operator } = await controller(t, {
    createRuntime: (config) => { const runtime = factory(config); runtimes.push(runtime); return runtime; },
    discoverTargets: async () => ({ targets: [
      { id: 'one', url: overlayUrl, title: 'Overlay one' }, { id: 'two', url: overlayUrl, title: 'Overlay two' },
      { id: 'unrelated', url: 'https://youtube.com/', title: 'Unrelated page' },
    ] }),
  });
  await operator.configure(settings); await operator.configure({ ...settings, channel: 'other', targetId: 'two' });
  assert.equal(runtimes[0].diagnostics().status, 'stopped');
  assert.equal(runtimes[1].config.targetId, 'two'); assert.equal(runtimes[1].config.targetUrl, overlayUrl);
  assert.deepEqual((await operator.targets()).map((target) => target.id), ['one', 'two']);
  assert.match(operator.overlay().sources[0].url, /embed\/other\/chat/);
});

test('corrupt persisted settings fail explicitly and remain untouched', async (t) => {
  const { operator, statePath } = await controller(t);
  await writeFile(statePath, '{corrupt');
  await assert.rejects(operator.load(), /could not be read/);
  assert.equal(await readFile(statePath, 'utf8'), '{corrupt');
});

test('operator actions are serialized, bounded, and cannot be added during shutdown', async (t) => {
  let release; const gate = new Promise((done) => { release = done; });
  const { operator } = await controller(t, { save: async () => gate });
  const pending = Array.from({ length: 8 }, () => operator.configure(settings));
  await assert.rejects(operator.connect(), /Too many pending/);
  const closed = operator.close();
  await assert.rejects(operator.connect(), /shutting down/);
  release(); await Promise.all(pending); await closed;
  assert.equal(operator.health().status, 'stopped');
});

test('local HTTP controls validate writes, origin, nonce, Host, body bounds and JSON without changing accepted settings', async (t) => {
  const { operator } = await controller(t);
  const server = createCoordinatorServer({ operator, health: () => operator.health() });
  t.after(() => new Promise((done) => server.close(done)));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`; operator.overlayUrl = `${base}/overlay`;
  const state = await (await fetch(`${base}/api/state`)).json();
  const headers = { Origin: base, 'Content-Type': 'application/json', 'X-Elmychat-Token': state.token };
  const post = (path, body, overrides = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { ...headers, ...overrides }, body });
  assert.equal((await post('/api/config', JSON.stringify(settings), { Origin: 'https://other.example' })).status, 403);
  assert.equal((await post('/api/config', JSON.stringify(settings), { 'X-Elmychat-Token': 'wrong' })).status, 403);
  assert.equal((await post('/api/config', JSON.stringify(settings), { 'Content-Type': 'text/plain' })).status, 415);
  assert.equal((await post('/api/config', '{broken')).status, 400);
  assert.equal((await post('/api/config', JSON.stringify({ ...settings, videoId: 'bad' }))).status, 400);
  assert.equal((await post('/api/config', JSON.stringify({ ...settings, extra: 'x'.repeat(16384) }))).status, 413);
  assert.equal(operator.state().configured, false);
  const response = await post('/api/config', JSON.stringify(settings)); assert.equal(response.status, 200);
  assert.equal((await response.json()).config.videoId, 'abcdefghijk');
  assert.equal((await post('/api/spacing', JSON.stringify({ type: 'gap', height: 32 }))).status, 200);
  assert.equal(operator.state().gap, 32);
  assert.equal((await post('/api/spacing', JSON.stringify({ type: 'gap', height: -1 }))).status, 400);
  assert.equal(operator.state().gap, 32);
  const foreignStatus = await new Promise((resolve, reject) => { const request = httpRequest(`${base}/api/state`, { headers: { Host: 'malicious.example' } }, (response) => { response.resume(); response.on('end', () => resolve(response.statusCode)); }); request.on('error', reject); request.end(); }); assert.equal(foreignStatus, 403);
  const options = await fetch(`${base}/api/config`, { method: 'OPTIONS', headers: { Origin: 'https://other.example' } });
  assert.equal(options.status, 405); assert.equal(options.headers.get('access-control-allow-origin'), null);
  const page = await fetch(base); assert.equal(page.headers.get('x-frame-options'), 'DENY'); assert.match(await page.text(), /Save and connect/);
  assert.equal((await post('/api/disconnect', '{}')).status, 200);
  assert.equal((await post('/api/spacing', JSON.stringify({ type: 'spacer-add', height: 1 }))).status, 409);
});

test('old saved settings default providers off; independent choices persist through reload and source edits', async t => {
  const { operator, statePath } = await controller(t);
  await writeFile(statePath, JSON.stringify({ version: 1, enabled: false, config: settings }));
  await operator.load();
  assert.deepEqual(operator.state().config.emotes, { sevenTv: false, betterTtv: false });
  for (const emotes of [{ sevenTv: true }, { betterTtv: true }, { sevenTv: true, betterTtv: true }, {}]) {
    await operator.configure({ ...settings, emotes });
    const saved = JSON.parse(await readFile(statePath, 'utf8'));
    assert.deepEqual(saved.config.emotes, { sevenTv: false, betterTtv: false, ...emotes });
    const reloaded = new OperatorController({ statePath, createRuntime: factory });
    await reloaded.load();
    assert.deepEqual(reloaded.state().config.emotes, saved.config.emotes);
    await reloaded.close();
  }
  await operator.configure({ ...settings, emotes: { sevenTv: true, betterTtv: true } });
  await operator.configure({ ...settings, channel: 'another' });
  assert.deepEqual(operator.state().config.emotes, { sevenTv: true, betterTtv: true });
  assert.deepEqual(operatorRuntimeConfig(operator.state().config, operator.overlayUrl).sources[0].emotes, operator.state().config.emotes);
  for (const emotes of [null, [], { sevenTv: 'true' }, { betterTtv: 1 }, { unknown: true }]) assert.throws(() => normalizeOperatorConfig({ ...settings, emotes }));
});

test('emote persistence or refresh preflight failure leaves live runtime and saved preferences intact', async t => {
  let fail = false;
  const runtimes = [];
  const { operator, statePath } = await controller(t, {
    createRuntime: config => { const runtime = factory(config); runtimes.push(runtime); return runtime; },
    save: async (path, state) => { if (fail) throw new Error('Disk full'); await writeFile(path, JSON.stringify(state)); },
  });
  await operator.configure(settings);
  await operator.spacing({ type: 'spacer-add', height: 71 });
  const spacer = operator.state().spacers[0];
  fail = true;
  await assert.rejects(operator.emotes({ emotes: { sevenTv: true } }), /Disk full/);
  fail = false;
  await assert.rejects(operator.emotes({ emotes: { sevenTv: true } }), /Wait for the selected OBS overlay/);
  assert.equal(runtimes.length, 1);
  assert.equal(runtimes[0].diagnostics().status, 'waiting');
  assert.deepEqual(operator.state().spacers, [spacer]);
  assert.deepEqual(operator.state().config.emotes, { sevenTv: false, betterTtv: false });
  assert.deepEqual(JSON.parse(await readFile(statePath, 'utf8')).config.emotes, operator.state().config.emotes);
  assert.deepEqual(runtimes[0].config.sources[0].emotes, operator.state().config.emotes);
  for (const input of [null, [], { emotes: { sevenTv: 1 } }, { retry: 'yes' }, { unknown: true }]) assert.throws(() => operator.emotes(input));
  await operator.disconnect();
  await assert.rejects(operator.emotes({ retry: true }), /Connect before applying/);
});

test('emote API uses the same origin/nonce validation and validates provider choices', async t => {
  const { operator } = await controller(t, { createRuntime: config => { const runtime = factory(config); runtime.applyEmotes = async () => ({ accepted: true }); return runtime; } });
  const server = createCoordinatorServer({ operator });
  t.after(() => new Promise(done => server.close(done)));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(`${base}/api/state`)).json();
  const headers = { Origin: base, 'X-Elmychat-Token': token, 'Content-Type': 'application/json' };
  const post = (body, changes = {}) => fetch(`${base}/api/emotes`, { method: 'POST', headers: { ...headers, ...changes }, body: JSON.stringify(body) });
  assert.equal((await post({ emotes: { sevenTv: true } }, { Origin: 'https://elsewhere.test' })).status, 403);
  assert.equal((await post({}, { 'X-Elmychat-Token': 'wrong' })).status, 403);
  await operator.configure(settings);
  assert.equal((await post({ emotes: { sevenTv: 'yes' } })).status, 400);
  const changed = await post({ emotes: { sevenTv: true, betterTtv: true } });
  assert.equal(changed.status, 200);
  assert.deepEqual((await changed.json()).config.emotes, { sevenTv: true, betterTtv: true });
});
