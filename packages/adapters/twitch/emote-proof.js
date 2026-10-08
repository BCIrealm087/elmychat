// Diagnostic only. No production preferences, message parsing or layout writes.
import { nativeMessageSelector, ffzMessageSelector, messageSelector } from './selectors.js';
import { ffzBootstrapUrl } from './ffz-bootstrap.js';
export { ffzBootstrapUrl } from './ffz-bootstrap.js';
export const emoteProofKey = '__elmychatEmoteProofV1';

export function emoteProofExpression(command) {
  return `(${nativeEmoteProof.toString()})(${JSON.stringify(command)}, ${JSON.stringify(ffzBootstrapUrl)}, ${JSON.stringify(emoteProofKey)}, ${JSON.stringify({native:nativeMessageSelector,ffz:ffzMessageSelector,all:messageSelector})})`;
}

function nativeEmoteProof(command, bootstrapUrl, key, selectors) {
  const previous = globalThis[key];
  if (command.operation !== 'begin') {
    if (!previous || previous.token !== command.token) throw new Error('Emote proof ownership mismatch.');
    if (previous.stopped) return { stopped: true, status: 'stopped', enhancerResetRequired: previous.resetRequired };
    return command.operation === 'stop' ? previous.stop() : previous.poll();
  }
  if (previous || globalThis.FrankerFaceZ || globalThis.ffz || globalThis.BetterTTV || globalThis.SevenTV ||
      [...document.scripts].some(script => {
        if (!script.src) return false;
        const host = new URL(script.src,location.href).hostname;
        return ['frankerfacez.com','betterttv.net','betterttv.com','7tv.app','7tv.io'].some(domain => host===domain || host.endsWith(`.${domain}`));
      })) {
    throw new Error('Existing enhancement or proof detected. Refresh only this Twitch source before testing.');
  }
  if (location.href !== command.documentUrl || !document.body) throw new Error('Selected Twitch document changed or is not ready.');
  const selector = selectors.all;
  const allRoots = () => [...document.querySelectorAll(selector)].filter(node => !node.parentElement?.closest(selector));
  const roots = () => allRoots().slice(-80);
  const initial = roots();
  if (!initial.length) throw new Error('Wait for native Twitch messages before starting the proof.');
  const typography = node => {
    const style = getComputedStyle(node);
    return [style.fontFamily, style.fontSize, style.lineHeight, style.whiteSpace, style.letterSpacing].join('|');
  };
  const baseline = initial.map(node => ({ node, parent: node.parentNode, nativeKey: node.getAttribute('data-id'),
    typography: typography(node), badges: [...node.querySelectorAll('[data-a-target="chat-badge"]')] }));
  const requested = command.mode === 'both' ? ['7tv-emotes', 'ffzap-bttv'] : [command.mode === '7tv' ? '7tv-emotes' : 'ffzap-bttv'];
  const ids = requested.includes('ffzap-bttv') ? ['ffzap-core', ...requested] : requested;
  let active = true; let manager; let configured = false; let savedBefore; let reason = null;
  let loadEvent = false; let resetRequired = false; let version = null;
  const violations = [];
  const loader = document.createElement('script');
  const security = event => {
    if (violations.length < 8) violations.push({ directive: event.effectiveDirective,
      blockedOrigin: (() => { try { return new URL(event.blockedURI).origin; } catch { return event.blockedURI.slice(0,80); } })() });
  };
  document.addEventListener('securitypolicyviolation', security);
  const stop = () => {
    if (active) {
      active = false; clearTimeout(expiry); document.removeEventListener('securitypolicyviolation', security);
      loader.onload = loader.onerror = null; loader.remove(); baseline.length = 0;
      if (resetRequired) globalThis[key] = { token: command.token, stopped: true, resetRequired };
      else delete globalThis[key];
    }
    // Keep a tiny tombstone: removing a script does not undo upstream hooks.
    return { stopped: true, enhancerResetRequired: resetRequired, reset: 'Refresh only the managed Twitch iframe before the next mode.' };
  };
  const expiry = setTimeout(stop, 180000);
  function poll() {
    if (!active) return { status: 'stopped', enhancerResetRequired: resetRequired };
    if (location.href !== command.documentUrl) reason = 'Selected source document changed.';
    const ffz = globalThis.FrankerFaceZ?.get?.();
    let providers = [];
    try {
      if (ffz && typeof ffz.resolve !== 'function') throw new Error('Unsupported FFZ resolve API.');
      manager = ffz?.resolve('addons');
      const emotes = ffz?.resolve('chat.emotes');
      const info = globalThis.FrankerFaceZ?.version_info;
      if (info) version = ['major','minor','revision','extra','build'].map(name => String(info[name] ?? '').slice(0,40)).join('.');
      if (!reason && manager?.enabled) {
        for (const method of ['hasAddon', 'getAddon', 'enableAddon', 'isAddonEnabled', 'doesAddonTarget']) {
          if (typeof manager[method] !== 'function') throw new Error(`Unsupported FFZ add-on API: ${method}.`);
        }
      }
      if (!reason && manager?.enabled && !configured && ids.every(id => manager.hasAddon(id))) {
        const storage = ffz.resolve('settings')?.provider;
        if (typeof storage?.get !== 'function' || !Array.isArray(manager.enabled_addons)) throw new Error('Unsupported FFZ settings API.');
        savedBefore = JSON.stringify(storage.get('addons.enabled', []));
        if (manager.enabled_addons.length || JSON.parse(savedBefore).length) throw new Error('Existing saved add-ons prevent an isolated provider proof.');
        for (const id of ids) {
          const required = manager.getAddon(id)?.requires ?? [];
          if (!Array.isArray(required) || required.some(dependency => !ids.includes(dependency) || ids.indexOf(dependency) >= ids.indexOf(id))) {
            throw new Error(`Unreviewed dependency for ${id}.`);
          }
          if (!manager.doesAddonTarget(id)) throw new Error(`Add-on ${id} does not support this FFZ target.`);
        }
        // FFZ can retain the provider's array by reference. Clone before changing
        // it, and explicitly enable dependencies without saving, in order.
        manager.enabled_addons = [...manager.enabled_addons];
        configured = true;
        for (const id of ids) manager.enableAddon(id, false);
      }
      if (configured && JSON.stringify(ffz.resolve('settings').provider.get('addons.enabled', [])) !== savedBefore) {
        throw new Error('Saved FFZ add-on preferences changed; isolation failed.');
      }
      providers = requested.map(id => {
        // FFZ's getters throw for unknown IDs while its manifest is loading.
        const registered = manager?.hasAddon?.(id) === true;
        const sets = Object.entries(emotes?.emote_sets ?? {}).filter(([,set]) => set?.__source === id);
        let images = 0; let visibleImages = 0; let retainedHostImages = 0;
        for (const root of roots()) for (const image of [...root.querySelectorAll('img[data-provider="ffz"][data-set]')].slice(0,100)) {
          if (emotes?.emote_sets?.[image.dataset.set]?.__source !== id || !image.complete || !image.naturalWidth) continue;
          images += 1;
          if (baseline.some(entry => entry.node === root && root.parentNode === entry.parent)) retainedHostImages += 1;
          const box = image.getBoundingClientRect(); const host = root.getBoundingClientRect(); const style = getComputedStyle(root);
          if (box.width > 0 && box.height > 0 && box.bottom > Math.max(0,host.top) && box.top < Math.min(innerHeight,host.bottom) &&
              box.right > Math.max(0,host.left) && box.left < Math.min(innerWidth,host.right) && style.visibility !== 'hidden' && Number(style.opacity) > 0) visibleImages += 1;
        }
        return { id, registered, requested: registered ? manager.isAddonEnabled(id) : false,
          moduleEnabled: ffz?.resolve(`addon.${id}`)?.enabled === true,
          manifestVersion: String((registered ? manager.getAddon(id)?.version : null) ?? 'unknown').slice(0,80),
          loadedVersion: String((registered ? manager.getVersion?.(id) : null) ?? 'unknown').slice(0,80),
          setCount: sets.length, emoteCount: sets.reduce((n,[,set]) => n + Object.keys(set.emotes ?? {}).length,0),
          loadedImages: images, visibleImages, retainedHostImages };
      });
    } catch (error) { reason = String(error.message).slice(0,240); }
    const connected = baseline.filter(entry => entry.node.isConnected);
    const ownership = { sampledRoots: baseline.length, connectedRoots: connected.length,
      removedRoots: baseline.length - connected.length,
      reparentedRoots: connected.filter(entry => entry.node.ownerDocument !== document || entry.node.parentNode !== entry.parent).length,
      changedNativeKeys: connected.filter(entry => entry.nativeKey !== entry.node.getAttribute('data-id')).length,
      changedTypography: connected.filter(entry => entry.typography !== typography(entry.node)).length,
      retainedBadges: connected.reduce((n,entry) => n + entry.badges.filter(badge => entry.node.contains(badge)).length,0),
      sampledBadges: baseline.reduce((n,entry) => n + entry.badges.length,0) };
    const current = allRoots();
    const geometricallyVisible = node => {
      const box = node.getBoundingClientRect(); const style = getComputedStyle(node);
      return box.width>0 && box.height>0 && box.bottom>0 && box.top<innerHeight && box.right>0 && box.left<innerWidth && style.visibility!=='hidden' && Number(style.opacity)>0;
    };
    const adapter = globalThis.__elmychatTwitchAdapterV1?.diagnostics();
    const nativeAdapter = adapter ? {status:adapter.status,failure:adapter.failure,trackedRoots:adapter.trackedRoots,
      retiredRoots:adapter.retiredRoots,revision:adapter.revision,messageWidth:adapter.messageWidth} : null;
    if (adapter && adapter.status!=='running') reason = `Native Twitch adapter ${adapter.status}: ${adapter.failure ?? 'inactive'}.`;
    const hosts = { currentRoots:current.length, sampledRoots:Math.min(80,current.length),
      nativeSelectorRoots:current.filter(node=>node.matches(selectors.native)).length,
      enhancedSelectorRoots:current.filter(node=>node.matches(selectors.ffz)).length,
      visibleRoots:current.slice(-80).filter(geometricallyVisible).length };
    const warnings = connected.length===0 && current.length>0 ? ['Baseline hosts were replaced; original-node retention is not demonstrated. Current hosts remain in the selected Twitch document.'] : [];
    const observed = providers.length === requested.length && providers.every(provider => provider.moduleEnabled && provider.visibleImages > 0);
    return { status: reason || ownership.reparentedRoots ? 'blocked' : observed ? 'render-observed' : configured ? 'awaiting-render' : 'loading',
      reason: reason ?? (ownership.reparentedRoots ? 'Baseline native host was reparented.' : null),
      loadEvent, enginePresent: !!ffz, configured, engineVersion: version, providers, ownership, hosts, nativeAdapter, warnings,
      preferenceIsolation: configured ? 'enabled-list-unchanged' : 'not-yet-checked', securityViolations: violations,
      enhancerResetRequired: resetRequired };
  }
  globalThis[key] = { token: command.token, poll, stop };
  loader.onload = () => { if (active) loadEvent = true; };
  loader.onerror = () => { if (active) reason = 'FFZ bootstrap failed (network, CSP or integrity).'; };
  try {
    loader.crossOrigin = 'anonymous'; loader.integrity = command.integrity;
    loader.src = bootstrapUrl; resetRequired = true; document.head.append(loader);
  } catch (error) { reason = `Bootstrap rejected: ${String(error.message).slice(0,180)}`; }
  return poll();
}
