import { ffzBootstrapUrl } from './ffz-bootstrap.js';

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
  return `(${nativeEnhancement.toString()})(${JSON.stringify(command)}, ${JSON.stringify(enhancementKey)}, ${JSON.stringify(ffzBootstrapUrl)})`;
}

// Runs only in the selected Twitch document. Never parses or positions messages.
function nativeEnhancement(command, key, url) {
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
  if (location.href !== command.documentUrl || !document.body || !document.head ||
      adapter?.status !== 'running' || adapter.sessionId !== command.sessionId) throw new Error('Native Twitch generation changed or is not ready.');
  const requested = [...(command.emotes.sevenTv ? ['7tv-emotes'] : []), ...(command.emotes.betterTtv ? ['ffzap-bttv'] : [])];
  if (!requested.length) throw new Error('No emote providers requested.');
  if (previous) {
    if (!owned || previous.documentUrl !== command.documentUrl || JSON.stringify(previous.requested) !== JSON.stringify(requested)) {
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
  const state = { owner: command.owner, binding: command.sessionId, documentUrl: command.documentUrl,
    requested, status: 'loading', reason: null, resetRequired: false, providers: [], engineVersion: null };
  const ids = requested.includes('ffzap-bttv') ? ['ffzap-core', ...requested] : requested;
  let active = true;
  let configured = false;
  let savedBefore;
  const loader = document.createElement('script');
  const release = () => { clearTimeout(expiry); loader.onload = loader.onerror = null; loader.remove(); };
  const fail = reason => { state.status = 'unavailable'; state.reason = reason; active = false; release(); };
  const snapshot = () => ({ status: state.status, reason: state.reason, resetRequired: state.resetRequired,
    engineVersion: state.engineVersion, providers: state.providers.map(provider => ({ ...provider })) });
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
      if (typeof engine.resolve !== 'function') throw new Error('Unsupported FFZ engine API.');
      const manager = engine.resolve('addons');
      if (!manager?.enabled) return snapshot();
      for (const method of ['hasAddon', 'getAddon', 'enableAddon', 'isAddonEnabled', 'doesAddonTarget']) {
        if (typeof manager[method] !== 'function') throw new Error(`Unsupported FFZ add-on API: ${method}.`);
      }
      if (!ids.every(id => manager.hasAddon(id))) return snapshot();
      const provider = engine.resolve('settings')?.provider;
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
      const emotes = engine.resolve('chat.emotes');
      if (!emotes || !emotes.emote_sets || typeof emotes.emote_sets !== 'object') throw new Error('Unsupported FFZ emote data API.');
      state.providers = requested.map(id => {
        const sets = Object.values(emotes.emote_sets).filter(set => set?.__source === id);
        const emoteCount = sets.reduce((count, set) => count + Object.keys(set.emotes ?? {}).length, 0);
        return { id, moduleReady: engine.resolve(`addon.${id}`)?.enabled === true && manager.isAddonEnabled(id),
          version: typeof manager.getVersion === 'function' ? String(manager.getVersion(id)).slice(0,80) : null,
          setCount: sets.length, emoteCount, dataStatus: sets.length ? 'available' : 'empty-or-pending' };
      });
      const version = globalThis.FrankerFaceZ.version_info;
      if (version) state.engineVersion = ['major', 'minor', 'revision'].map(name => String(version[name] ?? '').slice(0,40)).join('.');
      if (state.providers.every(provider => provider.moduleReady)) {
        state.status = 'ready'; clearTimeout(expiry);
      } else state.status = 'loading';
    } catch (error) { fail(String(error.message).slice(0,240)); }
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

