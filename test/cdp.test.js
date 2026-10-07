import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { CdpConnection, FrameContexts, requireLoopback, selectTarget } from '../packages/browser-control/cdp.js';
import { validateProofConfig } from '../scripts/proof/run-native-proof.js';

class Socket extends EventTarget {
  sent = [];
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.dispatchEvent(new Event('close')); }
  reply(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
}

test('CDP routes out-of-order replies by command ID and session and rejects on disconnect', async () => {
  const socket = new Socket();
  const connection = new CdpConnection(socket);
  const first = connection.send('Runtime.enable', {}, 'frame-one');
  const second = connection.send('Runtime.evaluate', { expression: '1' }, 'frame-two');
  assert.equal(socket.sent[0].sessionId, 'frame-one');
  socket.reply({ id: socket.sent[1].id, result: { value: 2 } });
  socket.reply({ id: socket.sent[0].id, error: { message: 'frame retired' } });
  await assert.rejects(first, /frame retired/);
  assert.deepEqual(await second, { value: 2 });
  const pending = connection.send('Runtime.enable');
  connection.close();
  await assert.rejects(pending, /closed/);
  await assert.rejects(connection.send('Runtime.enable'), /closed/);
});

test('target selection refuses missing/ambiguous pages and non-loopback endpoints', () => {
  for (const endpoint of ['http://192.168.1.2:9222', 'http://example.com:9222', 'http://user@localhost:9222', 'https://localhost:9222']) assert.throws(() => requireLoopback(endpoint));
  const target = { id: 'one', url: 'http://127.0.0.1:3210/proof', webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/one' };
  assert.equal(selectTarget([target], { targetUrl: target.url }), target);
  assert.throws(() => selectTarget([target, { ...target, id: 'two' }], { targetUrl: target.url }), /found 2/);
  assert.throws(() => selectTarget([target], { targetId: 'absent' }), /found 0/);
  assert.throws(() => selectTarget([target], {}), /Provide/);
  assert.throws(() => validateProofConfig({ sources: [], gap: -1 }));
});

test('context IDs are session-scoped and retired contexts cannot receive placements', async () => {
  const connection = new EventEmitter();
  connection.send = async () => ({ result: { value: true } });
  const frames = new FrameContexts(connection);
  for (const sessionId of ['a', 'b']) connection.emit('event', { method: 'Runtime.executionContextCreated', sessionId, params: { context: { id: 1, auxData: { isDefault: true } } } });
  assert.equal(frames.contexts.size, 2);
  const retired = frames.contexts.get('a:1');
  connection.emit('event', { method: 'Target.detachedFromTarget', params: { sessionId: 'a' } });
  assert.equal(frames.contexts.size, 1);
  await assert.rejects(frames.evaluate(retired, '1'), /retired/);
  frames.stop();
  assert.equal(connection.listenerCount('event'), 0);
});
