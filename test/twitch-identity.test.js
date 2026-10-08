import { test } from 'node:test';
import assert from 'node:assert/strict';
import { twitchRendererIdentity } from '../packages/adapters/twitch/identity.js';

test('renderer identity requires an exact Fine host and a bounded message ID, not parent/user/room metadata', t => {
  const prior = globalThis.FrankerFaceZ; t.after(() => { if (prior === undefined) delete globalThis.FrankerFaceZ; else globalThis.FrankerFaceZ = prior; });
  const node = {}; let host = node;
  const instance = { _ffz_no_scan: true, rendered: {}, props: { message: { id: 'real-message-id', roomId: 'room', user: { id: 'user' } } } };
  const fine = { searchParent: () => instance, getFirstChild: input => input.rendered,
    getChildNode: input => input._ffz_no_scan ? null : input === instance.rendered ? host : null };
  globalThis.FrankerFaceZ = { get: () => ({ resolve: () => fine }) };
  assert.equal(fine.getChildNode(instance), null, 'Fine must refuse descent through the upstream ChatLine scan guard.');
  assert.equal(twitchRendererIdentity(node), 'data-id:real-message-id');
  assert.equal(instance._ffz_no_scan, true, 'The reader must not weaken upstream scanning policy.');
  host = {}; assert.equal(twitchRendererIdentity(node), null);
  const child = instance.rendered; instance.rendered = null; assert.equal(twitchRendererIdentity(node), null); instance.rendered = child;
  host = node;
  for (const id of [undefined, null, 1, '', '  ', 'x'.repeat(513)]) { instance.props.message.id = id; assert.equal(twitchRendererIdentity(node), null); }
  globalThis.FrankerFaceZ = { get: () => ({ resolve: () => ({ ...fine, searchParent: () => { throw new Error('wrapper not registered'); } }) }) };
  assert.equal(twitchRendererIdentity(node), null);
  globalThis.FrankerFaceZ = { get: () => ({ resolve: () => ({ searchParent: () => instance }) }) };
  assert.equal(twitchRendererIdentity(node), null);
  globalThis.FrankerFaceZ = { get: () => ({ resolve: () => ({ searchParent: () => instance, getChildNode: () => node }) }) };
  assert.equal(twitchRendererIdentity(node), null, 'A missing child accessor must use conservative fallback.');
});
