import { ffzBootstrapUrl } from './ffz-bootstrap.js';
import { prepareFfzSettings } from './settings-isolation.js';

export const enhancementKey = '__elmychatTwitchEnhancementV1';

export function validateEmoteOptions(input) {
  if (input === undefined) return { sevenTv: false, betterTtv: false };
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some(key => !['sevenTv', 'betterTtv'].includes(key)) ||
      ['sevenTv', 'betterTtv'].some(key => input[key] !== undefined && typeof input[key] !== 'boolean')) {
    throw new TypeError('Twitch emotes require boolean sevenTv/betterTtv choices.');
  }
  return { sevenTv: input.sevenTv ?? false, betterTtv: input.betterTtv ?? false };
}

export function enhancementExpression(command) {
  return `(${nativeEnhancement.toString()})(${JSON.stringify(command)}, ${JSON.stringify(enhancementKey)}, ${JSON.stringify(ffzBootstrapUrl)}, ${prepareFfzSettings.toString()})`;
}

// Runs only in the selected Twitch document. Never parses or positions messages.
function nativeEnhancement(command, key, url, prepareSettings) {
  const previous = globalThis[key];
  const owned = previous?.owner === command.owner;
  if (command.operation === 'inspect') return previous ? { owned, status: previous.status, resetRequired: owned && previous.resetRequired } : null;
  if (command.operation !== 'begin') {
    if (!owned || previous.binding !== command.sessionId) throw new Error('Enhancement generation mismatch.');
    if (command.operation === 'reset') {
      if (location.href !== previous.documentUrl || previous.status !== 'unavailable' || !previous.resetRequired ||
          globalThis.__elmychatTwitchAdapterV1?.diagnostics().sessionId !== command.sessionId) throw new Error('Twitch reset ownership changed.');
      // The ownership check and reload execute in one task in this document.
      location.reload();
      return { resetRequested: true };
    }
    return command.operation === 'stop' ? previous.stop() : previous.poll();
  }
  const adapter = globalThis.__elmychatTwitchAdapterV1?.diagnostics();
  const waiting = location.href !== command.documentUrl ? 'Twitch URL changed before emote installation.' :
    !document.body || !document.head ? 'Waiting for the Twitch document.' :
    adapter?.status !== 'running' ? 'Waiting for the native Twitch adapter.' :
    adapter.sessionId !== command.sessionId ? 'Waiting for the selected native Twitch session.' : null;
  // No hooks or marker have been created. The coordinator may wait and supply
  // a fresh exact URL for this same context/session, without relaxing ownership.
  if (waiting) {
    // An existing wrapper may already have hooks. Keep its uncertain/partial
    // execution cleanup path rather than claiming preparation is untouched.
    if (previous) throw new Error(waiting);
    return { status: 'loading', reason: waiting, awaitingNative: true, resetRequired: false, providers: [] };
  }
  const requested = [...(command.emotes.sevenTv ? ['7tv-emotes'] : []), ...(command.emotes.betterTtv ? ['ffzap-bttv'] : [])];
  if (!requested.length) throw new Error('No emote providers requested.');
  if (previous) {
    if (!owned || previous.compatibilityVersion !== 2 || previous.documentUrl !== command.documentUrl || JSON.stringify(previous.requested) !== JSON.stringify(requested)) {
      throw new Error('Existing enhancement belongs to another owner or provider choice.');
    }
    // Reconnect can adopt this process's existing hooks, never inject twice.
    previous.binding = command.sessionId;
    return previous.poll();
  }
  if (globalThis.__elmychatEmoteProofV1 || globalThis.FrankerFaceZ || globalThis.ffz || globalThis.BetterTTV || globalThis.SevenTV ||
      [...document.scripts].some(script => script.src && ['frankerfacez.com', 'betterttv.net', 'betterttv.com', '7tv.app', '7tv.io'].some(domain => {
        const host = new URL(script.src, location.href).hostname;
        return host === domain || host.endsWith(`.${domain}`);
      }))) throw new Error('Existing chat enhancement detected; refresh Twitch before enabling emotes.');
  if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(command.integrity)) throw new Error('A verified FFZ bootstrap is required.');
  const loader = document.createElement('script');
  const isolation = prepareSettings(command.emotes);
  const state = { owner: command.owner, binding: command.sessionId, documentUrl: command.documentUrl, compatibilityVersion: 2,
    requested, status: 'loading', reason: null, resetRequired: false, providers: [], engineVersion: null };
  const ids = requested.includes('ffzap-bttv') ? ['ffzap-core', ...requested] : requested;
  let active = true;
  let configured = false;
  let savedBefore;
  let ownedEngine;
  const release = () => { clearTimeout(expiry); loader.onload = loader.onerror = null; loader.remove(); isolation.release(state.resetRequired); };
  const fail = reason => { state.status = 'unavailable'; state.reason = reason; active = false; release(); };
  const snapshot = () => ({ status: state.status, reason: state.reason, resetRequired: state.resetRequired,
    compatibilityVersion: 2, isolation: isolation.snapshot(), engineVersion: state.engineVersion,
    providers: state.providers.map(provider => ({ ...provider })) });
  state.stop = () => {
    active = false; release(); state.status = 'unavailable'; state.reason = 'Enhancement stopped; Twitch refresh required.';
    return snapshot();
  };
  state.poll = () => {
    if (!active) return snapshot();
    try {
      if (location.href !== state.documentUrl) throw new Error('Twitch document changed.');
      const current = globalThis.__elmychatTwitchAdapterV1?.diagnostics();
      if (current?.status !== 'running' || current.sessionId !== state.binding) throw new Error('Native Twitch generation is unavailable.');
      const engine = globalThis.FrankerFaceZ?.get?.();
      if (!engine) return snapshot();
      if (ownedEngine && engine !== ownedEngine || globalThis.BetterTTV || globalThis.SevenTV ||
          globalThis.__elmychatEmoteProofV1 || globalThis.ffz && globalThis.ffz !== engine) throw new Error('Competing chat enhancement detected.');
      ownedEngine = engine;
      if (typeof engine.resolve !== 'function') throw new Error('Unsupported FFZ engine API.');
      const manager = engine.resolve('addons');
      if (!manager?.enabled) return snapshot();
      for (const method of ['hasAddon', 'getAddon', 'enableAddon', 'isAddonEnabled', 'doesAddonTarget']) {
        if (typeof manager[method] !== 'function') throw new Error(`Unsupported FFZ add-on API: ${method}.`);
      }
      if (!ids.every(id => manager.hasAddon(id))) return snapshot();
      const settings = engine.resolve('settings');
      isolation.verify(settings);
      const provider = settings.provider;
      if (typeof provider?.get !== 'function' || !Array.isArray(manager.enabled_addons)) throw new Error('Unsupported FFZ settings API.');
      if (!configured) {
        const saved = provider.get('addons.enabled', []);
        if (!Array.isArray(saved) || saved.length || manager.enabled_addons.length) throw new Error('Existing FFZ add-on preferences prevent isolated enablement.');
        savedBefore = JSON.stringify(saved);
        for (const id of ids) {
          const requires = manager.getAddon(id)?.requires ?? [];
          if (!Array.isArray(requires) || requires.some(dependency => !ids.includes(dependency) || ids.indexOf(dependency) >= ids.indexOf(id))) {
            throw new Error(`Unreviewed dependency for ${id}.`);
          }
          if (!manager.doesAddonTarget(id)) throw new Error(`Unsupported FFZ target for ${id}.`);
        }
        manager.enabled_addons = [...manager.enabled_addons];
        configured = true;
        for (const id of ids) manager.enableAddon(id, false);
      }
      if (JSON.stringify(provider.get('addons.enabled', [])) !== savedBefore) throw new Error('Saved FFZ add-on preferences changed.');
      if (manager.enabled_addons.length > ids.length || new Set(manager.enabled_addons).size !== manager.enabled_addons.length ||
          manager.enabled_addons.some(id => !ids.includes(id))) throw new Error('Unexpected FFZ add-on enabled in this session.');
      const emotes = engine.resolve('chat.emotes');
      if (!emotes || !emotes.emote_sets || typeof emotes.emote_sets !== 'object') throw new Error('Unsupported FFZ emote data API.');
      const counts = new Map(requested.map(id => [id, { setCount: 0, emoteCount: 0, countsTruncated: false }]));
      let inspectedSets = 0, inspectedEmotes = 0;
      for (const setId in emotes.emote_sets) {
        if (++inspectedSets > 2048) { for (const count of counts.values()) count.countsTruncated = true; break; }
        if (!Object.hasOwn(emotes.emote_sets, setId)) continue;
        const set = emotes.emote_sets[setId], count = counts.get(set?.__source);
        if (!count) continue;
        count.setCount += 1;
        for (const name in set.emotes ?? {}) {
          if (++inspectedEmotes > 20000) { count.countsTruncated = true; break; }
          if (Object.hasOwn(set.emotes, name)) count.emoteCount += 1;
        }
        if (inspectedEmotes > 20000) { for (const count of counts.values()) count.countsTruncated = true; break; }
      }
      state.providers = requested.map(id => {
        const count = counts.get(id);
        return { id, moduleReady: engine.resolve(`addon.${id}`)?.enabled === true && manager.isAddonEnabled(id),
          version: typeof manager.getVersion === 'function' ? String(manager.getVersion(id)).slice(0,80) : null,
          ...count, dataStatus: count.setCount ? 'available' : 'empty-or-pending' };
      });
      const version = globalThis.FrankerFaceZ.version_info;
      if (version) state.engineVersion = ['major', 'minor', 'revision'].map(name => String(version[name] ?? '').slice(0,40)).join('.');
      if (state.providers.every(provider => provider.moduleReady)) {
        isolation.verify(settings, true);
        state.status = 'ready'; clearTimeout(expiry);
      } else state.status = 'loading';
    } catch (error) { fail(String(error?.message ?? error).slice(0,240)); }
    return snapshot();
  };
  const expiry = setTimeout(() => fail('Emote enhancement readiness timed out.'), 75000);
  globalThis[key] = state;
  loader.onerror = () => { if (active) fail('FFZ bootstrap failed (network, CSP or integrity).'); };
  try {
    loader.crossOrigin = 'anonymous'; loader.integrity = command.integrity; loader.src = url;
    // Mark uncertain execution before append: a failed response is not proof of no hooks.
    state.resetRequired = true; document.head.append(loader);
  } catch (error) { fail(`FFZ bootstrap rejected: ${String(error.message).slice(0,180)}`); }
  return state.poll();
}

