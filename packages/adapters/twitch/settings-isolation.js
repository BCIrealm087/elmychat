// Our FFZ dynamic-provider implementation. No upstream code is bundled.
// Serialized into the selected Twitch document before its bootstrap executes.
export function prepareFfzSettings(emotes) {
  const property = 'ffz_providers';
  const prior = Object.getOwnPropertyDescriptor(globalThis, property);
  if (globalThis[property] !== undefined || prior && !prior.configurable) throw new Error('Existing FFZ settings registration detected.');
  const policy = {
    'chat.rich.enabled': false,
    'chat.subs.native': true,
    'chat.badges.custom-mod': false,
    'chat.badges.custom-vip': false,
    'chat.badges.unify-bot-badge': 0,
    'chat.badges.fix-colors': false,
    'chat.badges.hidden': { 'm-ffz': true, 'm-addon': true, 'm-addon-7tv-emotes': true,
      'm-addon-ffzap-bttv': true, 'm-addon-ffzap-core': true },
    ...(emotes.sevenTv ? {
      'addon.seventv_emotes.nametag_paints': false,
      'addon.seventv_emotes.nametag_paints_drop_shadows': false,
      'addon.seventv_emotes.badges': false,
      'addon.seventv_emotes.animated_avatars': false,
    } : {}),
    ...(emotes.betterTtv ? {
      'ffzap.betterttv.pro_badges': false,
      'ffzap.betterttv.update_messages': false,
    } : {}),
  };
  const seeds = new Map([['profiles', JSON.stringify([{ id: 0, uuid: '807eaf46-7232-49b7-81eb-d91a9c89b78a',
    name: 'Elmychat emotes', context: [] }])], ['addons.enabled', '[]'],
  ...Object.entries(policy).map(([key, value]) => [`p:0:${key}`, JSON.stringify(value)])]);
  const maxEntries = 256, maxBytes = 65536, maxValueBytes = 4096;
  // FFZ builds these UI lists even without opening its settings menu. The
  // audited engine writes >9 KiB of cfg-seen keys in a fresh document.
  // They have no effect on emote data or the protected appearance policy.
  const uiKeys = new Set(['cfg-seen', 'cfg-collapsed']), maxUiValueBytes = 32768;
  let uiWritesDropped = 0;
  let instance, releaseValues, registered = false, stopped = false, problem = null, verified = false;
  let priorDefaults = [];
  const registry = [];
  const restoreRegistration = () => {
    if (globalThis[property] !== registry) return;
    // A later owner can change the descriptor as well as the value.
    if (!Object.getOwnPropertyDescriptor(globalThis, property)?.configurable) return;
    if (prior) Object.defineProperty(globalThis, property, prior);
    else delete globalThis[property];
  };
  const reject = message => { problem ??= message; throw new Error(message); };
  const register = event => {
    if (registered || typeof event?.Provider !== 'function' || typeof event.registerProvider !== 'function') {
      return reject('Unsupported FFZ dynamic settings API.');
    }
    registered = true;
    const manager = event.settings;
    class MemoryProvider extends event.Provider {
      #values;
      static priority = Number.MAX_SAFE_INTEGER;
      static title = 'Elmychat session';
      static allowTransfer = false;
      static shouldUpdate = false;
      static supported(settings) { return settings === manager; }
      static hasContent(settings) { return settings === manager; }
      static allowAsDefault(settings) { return settings === manager; }
      constructor(settings) {
        super(settings);
        if (instance || settings !== manager) reject('Duplicate or foreign FFZ settings provider.');
        this.#values = new Map(seeds); this.ready = true; instance = this;
        releaseValues = () => { this.#values = new Map(seeds); };
        restoreRegistration();
      }
      get size() { return this.#values.size; }
      get(key, fallback) { return this.#values.has(key) ? JSON.parse(this.#values.get(key)) : fallback; }
      has(key) { return this.#values.has(key); }
      keys() { return this.#values.keys(); }
      *entries() { for (const [key, value] of this.#values) yield [key, JSON.parse(value)]; }
      set(key, value) {
        if (stopped) return;
        if (typeof key !== 'string' || key.length > 256) reject('Invalid FFZ session settings key.');
        const encoded = JSON.stringify(value);
        if (typeof encoded !== 'string') reject('Invalid FFZ session settings value.');
        if (seeds.has(key)) {
          if (encoded !== seeds.get(key)) reject('Elmychat emote policy was changed.');
          return;
        }
        // Count UTF-8 bytes before retaining anything; no unbounded history.
        const bytes = new TextEncoder().encode(key + encoded).length;
        const optionalUi = uiKeys.has(key);
        let total = bytes;
        for (const [other, data] of this.#values) if (other !== key) total += new TextEncoder().encode(other + data).length;
        const exceedsCapacity = bytes > (optionalUi ? maxUiValueBytes : maxValueBytes) ||
          !this.#values.has(key) && this.#values.size >= maxEntries || total > maxBytes;
        if (exceedsCapacity) {
          // Keep the previous value intact. Optional UI bookkeeping must not
          // poison otherwise valid emote initialization when capacity is full.
          if (optionalUi) { uiWritesDropped = Math.min(uiWritesDropped + 1, 1000000); return; }
          reject('FFZ session settings capacity exceeded.');
        }
        this.#values.set(key, encoded); this.emit('set', key, value, false);
      }
      delete(key) {
        if (stopped) return;
        if (seeds.has(key)) reject('Elmychat emote policy was changed.');
        this.#values.delete(key); this.emit('set', key, undefined, true);
      }
      clear() { if (!stopped) reject('Elmychat emote policy was changed.'); }
      flush() {}
      broadcastTransfer() {}
      disableEvents() {}
    }
    event.registerProvider('elmychat-session', MemoryProvider);
  };
  registry.push(register);
  Object.defineProperty(globalThis, property, { value: registry, configurable: true, writable: true, enumerable: prior?.enumerable ?? false });
  return {
    verify(settings, ready = false) {
      if (problem) throw new Error(problem);
      if (!instance || settings?.provider !== instance || settings.disable_profiles ||
          typeof settings.get !== 'function' || !(settings.definitions instanceof Map)) {
        throw new Error('FFZ session settings isolation is unavailable.');
      }
      // Add-on definitions arrive asynchronously. Never mistake missing keys
      // for confirmed cosmetic isolation; final readiness requires all of them.
      const records = [];
      for (const [key, applied] of Object.entries(policy)) {
        const definition = settings.definitions.get(key);
        if (!definition) { if (ready) throw new Error(`Missing FFZ appearance setting: ${key}.`); continue; }
        const value = settings.get(key);
        const matches = typeof applied === 'object' ? value && typeof value === 'object' && !Array.isArray(value) &&
          Object.keys(value).length === Object.keys(applied).length && Object.entries(applied).every(([name,wanted]) => value[name] === wanted) : value === applied;
        if (!matches) throw new Error(`FFZ appearance policy mismatch: ${key}.`);
        const previous = definition.default;
        records.push({ key, priorDefault: previous == null || ['boolean', 'number'].includes(typeof previous) ? previous ?? null :
          typeof previous === 'string' ? previous.slice(0,80) : 'structured-or-computed', applied });
      }
      priorDefaults = records; verified = ready;
    },
    release(retainForLateBootstrap = true) {
      stopped = true;
      // Late upstream chunks must still find an isolated provider. Once chosen,
      // its global registration can be removed; FFZ retains its own class/hooks.
      if (instance) {
        releaseValues();
        restoreRegistration();
      } else if (!retainForLateBootstrap) restoreRegistration();
    },
    snapshot() {
      return { status: stopped ? 'released' : verified ? 'isolated' : 'pending',
        registrationRetained: globalThis[property] === registry,
        entries: instance?.size ?? seeds.size, maxEntries, maxBytes, maxValueBytes, maxUiValueBytes, uiWritesDropped,
        settings: priorDefaults.map(record => ({ ...record, applied: typeof record.applied === 'object' ? { ...record.applied } : record.applied })) };
    },
  };
}
