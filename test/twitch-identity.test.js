import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twitchRendererIdentity } from '../packages/adapters/twitch/identity.js';

test('renderer identity requires an exact Fine host and a bounded message ID, not parent/user/room metadata', t => {
  const prior = globalThis.FrankerFaceZ; t.after(() => { if (prior === undefined) delete globalThis.FrankerFaceZ; else globalThis.FrankerFaceZ = prior; });
  const node = {}; let host = node; const instance = { props: { message: { id: 'real-message-id', roomId: 'room', user: { id: 'user' } } } };
  globalThis.FrankerFaceZ = { get: () => ({ resolve: () => ({ searchParent: () => instance, getChildNode: () => host }) }) };
  assert.equal(twitchRendererIdentity(node), 'data-id:real-message-id');
  host = {}; assert.equal(twitchRendererIdentity(node), null);
  host = node;
  for (const id of [undefined, null, 1, '', '  ', 'x'.repeat(513)]) { instance.props.message.id = id; assert.equal(twitchRendererIdentity(node), null); }
  globalThis.FrankerFaceZ = { get: () => ({ resolve: () => ({ searchParent: () => { throw new Error('wrapper not registered'); }, getChildNode: () => node }) }) };
  assert.equal(twitchRendererIdentity(node), null);
  globalThis.FrankerFaceZ = { get: () => ({ resolve: () => ({ searchParent: () => instance }) }) };
  assert.equal(twitchRendererIdentity(node), null);
});
