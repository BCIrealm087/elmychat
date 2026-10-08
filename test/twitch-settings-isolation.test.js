import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import { prepareFfzSettings } from '../packages/adapters/twitch/settings-isolation.js';

class Provider extends EventEmitter {
  constructor(manager) { super(); this.manager = manager; }
  awaitReady() { return this.ready ? Promise.resolve() : Promise.reject(new Error('Not ready')); }
  get allowTransfer() { return this.constructor.allowTransfer; }
  get shouldUpdate() { return this.constructor.shouldUpdate; }
}
const emotes = { sevenTv: true, betterTtv: true };
function documentSettings(context = { Map, TextEncoder }, choices = emotes) {
  const isolation = vm.runInNewContext(`(${prepareFfzSettings.toString()})(${JSON.stringify(choices)})`, context);
  const registry = context.ffz_providers;
  const settings = { definitions: new Map(), get(key) { return settings.provider.get(`p:0:${key}`); } };
  let Class;
  function select() {
    Object.seal(registry);
    registry[0]({ settings, Provider, registerProvider: (key, type) => { assert.equal(key, 'elmychat-session'); Class = type; } });
    settings.provider = new Class(settings);
    for (const [key,value] of settings.provider.entries()) if (key.startsWith('p:0:')) settings.definitions.set(key.slice(4), { default: typeof value === 'boolean' ? !value : null });
    return settings.provider;
  }
  return { isolation, settings, select, context, registry, get Class() { return Class; } };
}

test('FFZ settings are document-local, copy values and preserve saved profiles/add-ons outside the selected document', async () => {
  const shared = new Map([['profiles', [{ name: 'Personal profile' }]], ['addons.enabled', ['unrelated-addon']], ['p:0:chat.font-size', 42]]);
  const before = structuredClone([...shared]);
  const first = documentSettings(), second = documentSettings();
  const one = first.select(), two = second.select();
  assert.equal(one.get('addons.enabled').length, 0); assert.equal(one.get('p:0:chat.font-size'), undefined);
  assert.equal(one.get('p:0:addon.seventv_emotes.nametag_paints'), false);
  assert.equal(one.get('p:0:chat.badges.custom-mod'), false);
  one.get('profiles')[0].name = 'Mutation'; assert.equal(one.get('profiles')[0].name, 'Elmychat emotes');
  one.set('scratch', { value: 123 }); one.get('scratch').value = 0;
  assert.equal(one.get('scratch').value, 123); assert.equal(two.get('scratch'), undefined);
  assert.equal(one.allowTransfer, false); assert.equal(one.shouldUpdate, false); await one.awaitReady();
  assert.equal(first.context.ffz_providers, undefined);
  first.isolation.verify(first.settings, true);
  const report = first.isolation.snapshot(); assert.equal(report.status, 'isolated'); assert.equal(report.settings.length, 13);
  const hidden = report.settings.find(record => record.key === 'chat.badges.hidden'); hidden.applied['m-ffz'] = false;
  assert.equal(first.isolation.snapshot().settings.find(record => record.key === 'chat.badges.hidden').applied['m-ffz'], true);
  first.isolation.release(); assert.equal(one.get('scratch'), undefined); one.set('after-stop', 1); assert.equal(one.get('after-stop'), undefined);
  assert.deepEqual([...shared], before);
  second.isolation.release();
});

test('foreign provider registrations are left untouched, including protected undefined properties', () => {
  for (const value of [[], [() => {}], {}]) {
    const context = { Map, TextEncoder, ffz_providers: value };
    assert.throws(() => documentSettings(context), /Existing FFZ settings/);
    assert.equal(context.ffz_providers, value);
  }
  const context = { Map, TextEncoder };
  Object.defineProperty(context, 'ffz_providers', { value: undefined, configurable: false });
  assert.throws(() => documentSettings(context), /Existing FFZ settings/);
});

test('unselected isolation, missing appearance APIs and changed policy block readiness', () => {
  const target = documentSettings(); const provider = target.select();
  assert.throws(() => target.isolation.verify({ ...target.settings, provider: { get: () => [] } }), /isolation is unavailable/);
  target.settings.definitions.delete('chat.rich.enabled');
  target.isolation.verify(target.settings);
  assert.throws(() => target.isolation.verify(target.settings, true), /Missing FFZ appearance setting/);
  assert.throws(() => provider.set('p:0:addon.seventv_emotes.badges', true), /policy was changed/);
  assert.throws(() => target.isolation.verify(target.settings), /policy was changed/);
  target.isolation.release();
});

test('settings capacity bounds entries, UTF-8 values and retained bytes, then releases scratch state', () => {
  for (const pressure of ['entries', 'value', 'bytes']) {
    const target = documentSettings(), provider = target.select();
    assert.throws(() => {
      if (pressure === 'value') provider.set('large', '界'.repeat(1500));
      else for (let i = 0; i < 300; i += 1) provider.set(`scratch-${i}`, pressure === 'bytes' ? 'x'.repeat(3900) : i);
    }, /capacity exceeded/);
    assert.ok(provider.size <= 256);
    const bytes = [...provider.entries()].reduce((sum,[key,value]) => sum + new TextEncoder().encode(key + JSON.stringify(value)).length,0);
    assert.ok(bytes <= 65536);
    target.isolation.release(); assert.equal(provider.size, 15);
  }
});

test('stop before delayed FFZ initialization leaves a safe bounded registration for late chunks', () => {
  const target = documentSettings(); target.isolation.release();
  assert.equal(target.isolation.snapshot().registrationRetained, true);
  const provider = target.select(); provider.set('late', 1);
  assert.equal(provider.get('late'), undefined);
  assert.equal(provider.get('p:0:addon.seventv_emotes.nametag_paints'), false);
  assert.equal(target.isolation.snapshot().status, 'released'); assert.equal(target.context.ffz_providers, undefined);
});

test('cleanup restores only its own registration and never overwrites a replacement', () => {
  const context = { Map, TextEncoder };
  Object.defineProperty(context, 'ffz_providers', { value: undefined, configurable: true, enumerable: true });
  const prior = Object.getOwnPropertyDescriptor(context, 'ffz_providers');
  const target = documentSettings(context); target.select();
  assert.deepEqual(Object.getOwnPropertyDescriptor(context, 'ffz_providers'), prior);
  const other = documentSettings(); const replacement = [];
  other.context.ffz_providers = replacement; other.select(); other.isolation.release();
  assert.equal(other.context.ffz_providers, replacement);
  const rejected = documentSettings(); rejected.isolation.release(false);
  assert.equal(rejected.context.ffz_providers, undefined);
});
