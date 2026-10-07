import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createCoordinatorServer } from '../apps/coordinator/src/server.js';

test('the starter serves its overlay and health without exposing other files', async (t) => {
  const server = createCoordinatorServer();
  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;

  const overlay = await fetch(`${base}/`);
  assert.equal(overlay.status, 200);
  assert.match(overlay.headers.get('content-type'), /^text\/html/);
  assert.match(await overlay.text(), /Native Twitch and YouTube chats are not connected yet/);

  const proof = await fetch(`${base}/proof?twitch=example&youtube=abcdefghijk`);
  assert.equal(proof.status, 200);
  assert.match(await proof.text(), /Elmychat native pair proof/);

  const health = await fetch(`${base}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', phase: 'scaffold', chatConnected: false });

  for (const path of ['/package.json', '/AGENTS.md', '/%2e%2e/package.json', '/unknown']) {
    const missing = await fetch(`${base}${path}`);
    assert.equal(missing.status, 404);
    await missing.text();
  }
  const post = await fetch(`${base}/health`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  await post.text();

  const head = await fetch(`${base}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('native route and health expose current coordinator state', async (t) => {
  let state = { status: 'waiting', chatConnected: false };
  const server = createCoordinatorServer({ health: () => state });
  t.after(() => new Promise((done) => server.close(done)));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(`${base}/native?twitch=example&youtube=abcdefghijk`)).text(), /www.twitch.tv/);
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), state);
  state = { status: 'connected', chatConnected: true };
  assert.deepEqual(await (await fetch(`${base}/health`)).json(), state);
});
