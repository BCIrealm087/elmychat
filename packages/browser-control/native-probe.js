/** Runs inside the native document. This one-box probe is not a production adapter. */
export function nativeProbe(options) {
  const key = '__elmychatFeasibilityProbeV1';
  if (options.operation === 'restore') {
    const state = globalThis[key];
    if (!state || state.token !== options.token) return { restored: false };
    for (const [element, style] of state.styles) {
      if (style === null) element.removeAttribute('style'); else element.setAttribute('style', style);
    }
    delete globalThis[key];
    return { restored: true };
  }
  if (options.operation === 'measure') {
    const nodes = [...document.querySelectorAll(options.selector)];
    const element = nodes.find((node) => {
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
    });
    if (!element) throw new Error('No measurable native message matched the supplied selector.');
    if (globalThis[key]) throw new Error('A native proof is already active in this context; restore it first.');
    const rect = element.getBoundingClientRect();
    const state = { token: options.token, element, styles: new Map(), descendants: [...element.querySelectorAll('*')] };
    globalThis[key] = state;
    return { width: rect.width, height: rect.height, tag: element.tagName, descendantCount: state.descendants.length, viewport: { width: innerWidth, height: innerHeight } };
  }
  const state = globalThis[key];
  if (!state || state.token !== options.token || !state.element.isConnected) throw new Error('The selected native node/session is no longer available.');
  const element = state.element;
  if (options.operation === 'place') {
    const save = (node) => { if (!state.styles.has(node)) state.styles.set(node, node.getAttribute('style')); };
    const apply = (node, properties) => {
      save(node);
      // Attribute writes preserve the original snapshot without leaving dirty
      // CSSOM declarations that can re-create an empty attribute on teardown.
      const declarations = Object.entries(properties).map(([name, value]) => `${name}: ${value} !important;`).join(' ');
      node.setAttribute('style', `${node.getAttribute('style') ?? ''}; ${declarations}`);
    };
    for (let node = element.parentElement; node; node = node.parentElement) {
      apply(node, { visibility: 'hidden', background: 'transparent', transform: 'none', filter: 'none', perspective: 'none', contain: 'none', overflow: 'visible', opacity: '1' });
    }
    apply(element, { position: 'fixed', top: `${options.y}px`, left: '0px', width: `${options.width}px`, 'box-sizing': 'border-box', margin: '0px', visibility: 'visible', transform: 'none', 'z-index': '2147483647' });
  }
  const rect = element.getBoundingClientRect();
  return {
    x: rect.x, y: rect.y, width: rect.width, height: rect.height,
    sameNativeNode: element === state.element && element.ownerDocument === document,
    sameDescendants: state.descendants.every((node) => node.isConnected && element.contains(node)),
  };
}

export function probeExpression(options) { return `(${nativeProbe.toString()})(${JSON.stringify(options)})`; }
