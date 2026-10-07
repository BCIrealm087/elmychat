/** Platform-independent browser lifecycle; selectors are supplied by adapter policy. */
function nativeRuntime(options = {}, policy) {
  const { key, platform, rootTypes, containerSelector, identityAttributes } = policy;
  const selector = rootTypes.map(type => type.selector).join(',');
  const { sourceId, sessionId, maxRoots = 500, maxReports = 1000 } = options;
  const validId = (value) => typeof value === 'string' && value.trim() && value.length <= 512;
  const pixel = (value, positive = false) => Number.isFinite(value) && value >= 0 && value <= 1_000_000 && (!positive || value > 0);
  if (!validId(sourceId) || !validId(sessionId) || !pixel(options.width, true)) throw new TypeError('sourceId, sessionId and positive measurement width are required.');
  if (!Number.isInteger(maxRoots) || maxRoots < 1 || maxRoots > 1000 || !Number.isInteger(maxReports) || maxReports < 1 || maxReports > 10_000) throw new RangeError('Invalid adapter bounds.');
  if (globalThis[key]?.diagnostics().status === 'running') throw new Error(`A ${platform} adapter is already running; stop its session first.`);
  if (!document.body || typeof ResizeObserver !== 'function') throw new Error('The native document and ResizeObserver must be ready.');

  let width = options.width;
  // Reports address the shared viewport; a platform may wrap its native box
  // in a narrower column while retaining that same placement coordinate space.
  const messageWidth = (entry) => Math.min(Math.max(1, width - (entry?.gutter ?? 0)), policy.messageWidthLimit ?? width);
  let status = 'running';
  let failure = null;
  let frame = null;
  let sequence = 0;
  let revision = 0;
  let waitingForContainer = false;
  const roots = new Map();
  const reports = new Map();
  const styles = new Map();
  const recycled = new Set();
  // Decorations are siblings of native roots, never native text/child mutations.
  const decorations = new WeakSet();
  const decorationStyles = new WeakMap();
  const markerEntries = new WeakMap();
  let markerLayer = null;
  const counts = { added: 0, removed: 0, resized: 0, styleRepairs: 0, flushes: 0 };
  const parseStyle = (raw) => { const node = document.createElement('div'); node.setAttribute('style', raw ?? ''); return node.style; };
  const address = (entry) => ({ sourceId, sessionId, messageId: entry.messageId });
  const authorized = (command) => command?.sourceId === sourceId && command?.sessionId === sessionId;
  const rejected = (reason) => ({ accepted: false, reason });
  const nativeKeyFor = (node) => {
    for (const attribute of identityAttributes) {
      const value = node.getAttribute(attribute);
      if (value) {
        if (value.length > 65_536) throw new Error('native-key-limit');
        return `${attribute}:${value}`;
      }
    }
    return null;
  };

  // Keep untouched attributes byte-for-byte. When the platform writes styles,
  // preserve its new declarations while removing unchanged adapter declarations.
  function rebase(node, record) {
    const current = node.getAttribute('style');
    if (current === record.applied) return;
    const changed = parseStyle(current);
    const prior = parseStyle(record.base);
    const owned = parseStyle(record.applied);
    let stripped = false;
    for (const property of record.properties) {
      if (changed.getPropertyValue(property) && changed.getPropertyValue(property) === owned.getPropertyValue(property) && changed.getPropertyPriority(property) === owned.getPropertyPriority(property)) {
        stripped = true;
        if (prior.getPropertyValue(property)) changed.setProperty(property, prior.getPropertyValue(property), prior.getPropertyPriority(property));
        else changed.removeProperty(property);
      }
    }
    record.base = stripped ? changed.cssText : current;
  }

  function applyStyle(node, properties) {
    let record = styles.get(node);
    if (!record) {
      if (styles.size >= 4096) throw new Error('styled-node-limit');
      record = { base: node.getAttribute('style'), applied: null, properties: new Set() };
      record.applied = record.base;
      styles.set(node, record);
    }
    if ((node.getAttribute('style')?.length ?? 0) > 65_536) throw new Error('inline-style-limit');
    if (node.getAttribute('style') !== record.applied) { rebase(node, record); counts.styleRepairs += 1; }
    record.properties = new Set(Object.keys(properties));
    const declarations = Object.entries(properties).map(([name, value]) => `${name}: ${value} !important;`).join(' ');
    const desired = `${record.base ?? ''}; ${declarations}`;
    record.applied = desired;
    if (node.getAttribute('style') !== desired) node.setAttribute('style', desired);
  }

  function restoreStyle(node) {
    const record = styles.get(node);
    if (!record) return;
    rebase(node, record);
    if (record.base === null) node.removeAttribute('style'); else node.setAttribute('style', record.base);
    styles.delete(node);
  }

  function decorateStyle(node, properties) {
    const desired = Object.entries({ all: 'initial', ...properties }).map(([name, value]) => `${name}: ${value} !important;`).join(' ');
    decorationStyles.set(node, desired);
    if (node.getAttribute('style') !== desired) node.setAttribute('style', desired);
  }

  function ensureMarker(entry) {
    if (!policy.originMark) return;
    if (!markerLayer) {
      markerLayer = document.createElement('div');
      markerLayer.setAttribute('data-elmychat-origin-layer', platform);
      decorations.add(markerLayer);
    }
    decorateStyle(markerLayer, { position: 'fixed', inset: '0', 'pointer-events': 'none', visibility: 'visible', 'z-index': '2147483647' });
    if (markerLayer.parentNode !== document.body) document.body.append(markerLayer);
    if (!entry.marker) {
      const marker = document.createElement('span');
      marker.setAttribute('data-elmychat-origin', platform);
      marker.setAttribute('role', 'img');
      marker.setAttribute('aria-label', `${policy.originMark.label} message`);
      marker.setAttribute('title', policy.originMark.label);
      // Shadow isolation protects the bundled mark from native page SVG rules.
      marker.attachShadow({ mode: 'open' }).innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="display:block">${policy.originMark.underlay ? `<path fill="white" d="${policy.originMark.underlay}"/>` : ''}<path fill="${policy.originMark.color}" d="${policy.originMark.path}"/></svg>`;
      decorations.add(marker);
      markerEntries.set(marker, entry);
      entry.marker = marker;
    }
    if (entry.marker.parentNode !== markerLayer) markerLayer.append(entry.marker);
  }

  function positionMarker(entry) {
    if (!entry.marker) return;
    const placement = entry.placement;
    const visible = !entry.retired && placement?.visible && placement.rect.width === width;
    const x = (placement?.rect.x ?? 0) + 2;
    const y = (placement?.rect.y ?? 0) + entry.markerTop;
    const area = visible ? placement.clip : null;
    // Intersect with the message as well: tiny rows cannot leak into spacers.
    const left = area ? Math.max(x, area.x) : x;
    const top = area ? Math.max(y, area.y) : y;
    const right = area ? Math.min(x + 16, area.x + area.width) : x;
    const bottom = area ? Math.min(y + 16, area.y + area.height, placement.rect.y + placement.rect.height) : y;
    decorateStyle(entry.marker, {
      display: 'block', position: 'fixed', left: `${x}px`, top: `${y}px`, width: '16px', height: '16px',
      'box-sizing': 'border-box', padding: '1px', 'border-radius': '3px', background: 'rgba(24,24,27,0.85)',
      'box-shadow': 'inset 0 0 0 1px rgba(255,255,255,0.16)', 'pointer-events': 'none',
      visibility: right > left && bottom > top ? 'visible' : 'hidden',
      'clip-path': `inset(${Math.max(0, top - y)}px ${Math.max(0, x + 16 - right)}px ${Math.max(0, y + 16 - bottom)}px ${Math.max(0, left - x)}px)`,
    });
  }

  function terminate(reason) {
    if (status !== 'running') return;
    status = reason === 'teardown' || reason === 'pagehide' ? 'stopped' : 'failed';
    failure = status === 'failed' ? reason : null;
    observer.disconnect();
    resizer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('resize', schedule);
    for (const node of [...styles.keys()]) restoreStyle(node);
    markerLayer?.remove();
    markerLayer = null;
    roots.clear();
    recycled.clear();
    reports.clear();
  }

  function enqueue(entry, type, reason) {
    const pending = reports.get(entry.messageId);
    if (type === 'removed' && pending?.type === 'added') { reports.delete(entry.messageId); return; }
    if (type === 'removed' && !entry.delivered) return;
    const event = { type: type === 'resized' && pending?.type === 'added' ? 'added' : type, ...address(entry), messageKind: entry.messageKind };
    if (type === 'removed') event.reason = reason;
    else Object.assign(event, { width, height: entry.height });
    if (!reports.has(entry.messageId) && reports.size >= maxReports) throw new Error('report-overflow');
    reports.set(entry.messageId, event);
  }

  function discard(entry, reason) {
    if (!entry.retired) { counts.removed += 1; enqueue(entry, 'removed', reason); }
    resizer.unobserve(entry.node);
    restoreStyle(entry.node);
    entry.marker?.remove();
    roots.delete(entry.node);
  }

  function rootProperties(entry) {
    const placement = entry.placement;
    const visible = !entry.retired && placement?.visible && placement.rect.width === width;
    let clip = 'none';
    if (visible) {
      const { rect, clip: area } = placement;
      const x = rect.x + entry.gutter;
      const offsets = [area.y - rect.y, x + messageWidth(entry) - area.x - area.width, rect.y + rect.height - area.y - area.height, area.x - x].map((value) => Math.max(0, value));
      clip = `inset(${offsets.map((value) => `${value}px`).join(' ')})`;
    }
    return {
      position: 'fixed', top: `${placement?.rect.y ?? 0}px`, left: `${(placement?.rect.x ?? 0) + entry.gutter}px`,
      width: `${messageWidth(entry)}px`, height: 'auto', 'min-width': '0', 'max-width': 'none', 'min-height': '0', 'max-height': 'none',
      'box-sizing': 'border-box', margin: '0', visibility: visible ? 'visible' : 'hidden',
      transform: 'none', 'z-index': '2147483647', 'clip-path': clip,
    };
  }

  function flush() {
    frame = null;
    if (status !== 'running') return;
    try {
      counts.flushes += 1;
      const containers = containerSelector ? [...document.querySelectorAll(containerSelector)] : [document];
      if (containers.length > 1) throw new Error('ambiguous-message-container');
      const container = containers[0];
      waitingForContainer = !container;
      // Only outermost supported roots count; nested renderers stay in their
      // owning card. Ticker/pinned copies outside the list are not admitted.
      const candidates = container ? [...container.querySelectorAll(selector)].filter(node => !node.parentElement?.closest(selector)) : [];
      if (candidates.length > maxRoots) throw new Error('native-root-limit');
      for (const entry of [...roots.values()]) {
        const nativeKey = nativeKeyFor(entry.node);
        if (!entry.node.isConnected || !entry.node.matches(selector)) discard(entry, entry.node.isConnected ? 'selector-lost' : 'node-removed');
        else if (!container?.contains(entry.node)) discard(entry, 'scope-lost');
        else if (recycled.has(entry.node) || nativeKey !== entry.nativeKey) discard(entry, 'node-reused');
      }
      recycled.clear();
      for (const node of candidates) {
        if (roots.has(node)) continue;
        if (!Number.isSafeInteger(sequence + 1)) throw new Error('identity-sequence-exhausted');
        const messageKind = rootTypes.find(type => node.matches(type.selector)).kind;
        const entry = { node, messageId: `${platform}-${++sequence}`, messageKind, nativeKey: nativeKeyFor(node), height: null, measuredWidth: null, gutter: 0, markerTop: 0, delivered: false, retired: false, placement: null };
        roots.set(node, entry);
        resizer.observe(node);
      }
      const ancestors = new Set([document.documentElement, document.body]);
      for (const entry of roots.values()) {
        let depth = 0;
        for (let node = entry.node.parentElement; node; node = node.parentElement) {
          if (++depth > 64) throw new Error('ancestor-depth-limit');
          ancestors.add(node);
        }
      }
      const used = new Set([...ancestors, ...roots.keys()]);
      for (const node of [...styles.keys()]) if (!used.has(node)) restoreStyle(node);
      for (const node of ancestors) applyStyle(node, {
        visibility: 'hidden', background: 'transparent', transform: 'none', filter: 'none', perspective: 'none',
        contain: 'none', 'will-change': 'auto', 'content-visibility': 'visible', 'clip-path': 'none', opacity: '1',
        overflow: node === document.body || node === document.documentElement ? 'hidden' : 'visible',
      });
      for (const entry of roots.values()) {
        const nativeStyle = getComputedStyle(entry.node);
        const padding = parseFloat(nativeStyle.paddingLeft) || 0;
        entry.gutter = policy.originMark && padding < 20 ? Math.min(20, Math.max(0, width - 1)) : 0;
        const lineHeight = parseFloat(nativeStyle.lineHeight) || (parseFloat(nativeStyle.fontSize) || 14) * 1.4;
        entry.markerTop = Math.max(0, (parseFloat(nativeStyle.paddingTop) || 0) + (lineHeight - 16) / 2);
        ensureMarker(entry);
        applyStyle(entry.node, rootProperties(entry));
        positionMarker(entry);
        if (entry.retired) continue;
        const rect = entry.node.getBoundingClientRect();
        if (!pixel(rect.height) || !pixel(rect.width, true) || Math.abs(rect.width - messageWidth(entry)) > 1) throw new Error('measurement-width-or-height-invalid');
        if (entry.height === null || Math.abs(entry.height - rect.height) > 0.01 || entry.measuredWidth !== width) {
          const first = entry.height === null;
          entry.height = rect.height;
          entry.measuredWidth = width;
          counts[first ? 'added' : 'resized'] += 1;
          enqueue(entry, first ? 'added' : 'resized');
        }
      }
    } catch (error) { terminate(error.message); }
  }

  function schedule() { if (status === 'running' && frame === null) frame = requestAnimationFrame(flush); }
  const resizer = new ResizeObserver(schedule);
  const observer = new MutationObserver((records) => {
    if (status !== 'running') return;
    if (records.length > 10_000) { terminate('mutation-batch-limit'); return; }
    let dirty = false;
    for (const record of records) {
      if (decorations.has(record.target)) {
        // Own writes stay idle; repair foreign removal/style writes without
        // treating any decoration as a native message-content replacement.
        if (record.type === 'attributes' && decorationStyles.get(record.target) !== record.target.getAttribute('style')) dirty = true;
        if (record.type === 'childList' && [...record.removedNodes].some(node => roots.has(markerEntries.get(node)?.node))) dirty = true;
        continue;
      }
      if (record.type === 'childList' && [...record.addedNodes, ...record.removedNodes].every(node => decorations.has(node))) {
        if (markerLayer && !markerLayer.isConnected) dirty = true;
        continue;
      }
      if (record.type === 'attributes' && record.attributeName === 'style' && styles.get(record.target)?.applied === record.target.getAttribute('style')) continue;
      dirty = true;
      if (record.type === 'childList') {
        for (const node of record.removedNodes) for (const entry of roots.values()) if (node === entry.node || node.contains(entry.node)) recycled.add(entry.node);
      }
      // Without a stable native key, content replacement is conservatively a
      // new identity. Image sizing and style changes keep the existing identity.
      if (record.type === 'childList' || record.type === 'characterData') {
        const element = record.target.nodeType === 1 ? record.target : record.target.parentElement;
        for (let root = element?.closest(selector); root; root = root.parentElement?.closest(selector)) {
          const entry = roots.get(root);
          if (entry) { if (!entry.nativeKey) recycled.add(root); break; }
        }
      }
    }
    if (dirty) schedule();
  });
  function onPageHide() { terminate('pagehide'); }

  function commandAllowed(command) {
    if (!authorized(command)) return rejected('stale-session');
    if (status !== 'running') return rejected('adapter-inactive');
    return null;
  }

  function validatePlacement(placement) {
    if (!authorized(placement) || !validId(placement.messageId) || typeof placement.visible !== 'boolean') throw new TypeError('Invalid placement identity or visibility.');
    const rect = placement.rect;
    if (!rect || !Number.isFinite(rect.x) || Math.abs(rect.x) > 1e10 || !Number.isFinite(rect.y) || Math.abs(rect.y) > 1e10 || !pixel(rect.width) || !pixel(rect.height)) throw new RangeError('Invalid placement rectangle.');
    if (!placement.visible) return;
    const area = placement.clip;
    if (placement.needsMeasurement || !area || !Number.isFinite(area.x) || !Number.isFinite(area.y) || !pixel(area.width, true) || !pixel(area.height, true) || area.x < rect.x - 1e-7 || area.y < rect.y - 1e-7 || area.x + area.width > rect.x + rect.width + 1e-7 || area.y + area.height > rect.y + rect.height + 1e-7) throw new RangeError('Visible placement requires a valid intersection.');
  }

  const api = Object.freeze({
    diagnostics: () => ({ sourceId, sessionId, selector, containerSelector, waitingForContainer, status, failure, width, messageWidth: messageWidth(), originMarkers: [...roots.values()].filter(entry => entry.marker).length, gutterMessages: [...roots.values()].filter(entry => entry.gutter).length, revision, trackedRoots: roots.size, retiredRoots: [...roots.values()].filter((entry) => entry.retired).length, pendingReports: reports.size, styledNodes: styles.size, ...counts }),
    takeReports(command) {
      if (!authorized(command)) return rejected('stale-session');
      const events = [...reports.values()];
      // Mark delivered roots in one pass, including coalesced add/resize reports.
      if (events.length) for (const entry of roots.values()) if (reports.get(entry.messageId)?.type === 'added') entry.delivered = true;
      reports.clear();
      return { accepted: true, status, failure, events };
    },
    setWidth(command) {
      const denial = commandAllowed(command);
      if (denial) return denial;
      if (!pixel(command.width, true)) throw new RangeError('Measurement width must be positive.');
      if (width !== command.width) {
        width = command.width;
        for (const entry of roots.values()) entry.placement = null;
        schedule();
      }
      return { accepted: true };
    },
    applyPlacements(command) {
      const denial = commandAllowed(command);
      if (denial) return denial;
      if (!Number.isSafeInteger(command.revision) || command.revision < 1 || !Array.isArray(command.placements) || command.placements.length > maxRoots) throw new TypeError('A bounded placement batch and positive revision are required.');
      if (command.revision <= revision) return rejected('stale-layout');
      const unique = new Set();
      for (const placement of command.placements) {
        validatePlacement(placement);
        if (unique.has(placement.messageId)) throw new TypeError('Duplicate placement identity.');
        unique.add(placement.messageId);
      }
      if (command.placements.some((placement) => placement.visible && placement.rect.width !== width)) return rejected('stale-width');
      revision = command.revision;
      const byId = new Map(command.placements.map((placement) => [placement.messageId, placement]));
      for (const entry of roots.values()) {
        if (entry.retired) continue;
        const placement = byId.get(entry.messageId);
        // Full snapshot: absence hides a root, never leaves an old placement.
        entry.placement = placement ? {
          visible: placement.visible,
          rect: { x: placement.rect.x, y: placement.rect.y, width: placement.rect.width, height: placement.rect.height },
          clip: placement.visible ? { x: placement.clip.x, y: placement.clip.y, width: placement.clip.width, height: placement.clip.height } : null,
        } : null;
      }
      schedule();
      return { accepted: true };
    },
    retireMessages(command) {
      const denial = commandAllowed(command);
      if (denial) return denial;
      if (!Array.isArray(command.messageIds) || command.messageIds.length > maxRoots || command.messageIds.some((value) => !validId(value))) throw new TypeError('A bounded message ID list is required.');
      const ids = new Set(command.messageIds);
      try {
        for (const entry of roots.values()) if (ids.has(entry.messageId) && !entry.retired) {
          enqueue(entry, 'removed', 'coordinator-retired');
          entry.retired = true;
          counts.removed += 1;
          entry.placement = null;
          resizer.unobserve(entry.node);
        }
        schedule();
      } catch (error) { terminate(error.message); }
      return { accepted: true, status, failure };
    },
    stop(command) {
      const denial = commandAllowed(command);
      if (denial) return denial;
      terminate('teardown');
      return { accepted: true, restored: true };
    },
  });
  globalThis[key] = api;
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...new Set(['style', 'class', 'hidden', ...identityAttributes, ...policy.selectorAttributes])] });
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('resize', schedule);
  schedule();
  return { installed: true, sourceId, sessionId, selector, containerSelector };
}

/** Compile a dependency-free function in Node for direct browser/CDP evaluation.
 * Policy is fixed by the platform module, never supplied by native chat content.
 */
export function createNativeAdapter(policy) {
  return new Function('options', `return (${nativeRuntime.toString()})(options, ${JSON.stringify(policy)});`);
}
