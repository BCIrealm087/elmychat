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
    roots.delete(entry.node);
  }

  function rootProperties(entry) {
    const placement = entry.placement;
    const visible = !entry.retired && placement?.visible && placement.rect.width === width;
    let clip = 'none';
    if (visible) {
      const { rect, clip: area } = placement;
      const offsets = [area.y - rect.y, rect.x + rect.width - area.x - area.width, rect.y + rect.height - area.y - area.height, area.x - rect.x].map((value) => Math.max(0, value));
      clip = `inset(${offsets.map((value) => `${value}px`).join(' ')})`;
    }
    return {
      position: 'fixed', top: `${placement?.rect.y ?? 0}px`, left: `${placement?.rect.x ?? 0}px`,
      width: `${width}px`, height: 'auto', 'min-width': '0', 'max-width': 'none', 'min-height': '0', 'max-height': 'none',
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
        const entry = { node, messageId: `${platform}-${++sequence}`, messageKind, nativeKey: nativeKeyFor(node), height: null, measuredWidth: null, delivered: false, retired: false, placement: null };
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
        applyStyle(entry.node, rootProperties(entry));
        if (entry.retired) continue;
        const rect = entry.node.getBoundingClientRect();
        if (!pixel(rect.height) || !pixel(rect.width, true) || Math.abs(rect.width - width) > 1) throw new Error('measurement-width-or-height-invalid');
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
    diagnostics: () => ({ sourceId, sessionId, selector, containerSelector, waitingForContainer, status, failure, width, revision, trackedRoots: roots.size, retiredRoots: [...roots.values()].filter((entry) => entry.retired).length, pendingReports: reports.size, styledNodes: styles.size, ...counts }),
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
