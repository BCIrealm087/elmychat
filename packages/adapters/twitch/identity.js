/** Read through FFZ's inspected Fine API; never scan React internals ourselves. */
export function twitchRendererIdentity(node) {
  try {
    const engine = globalThis.FrankerFaceZ?.get?.();
    const fine = engine?.resolve?.('site.fine');
    if (typeof fine?.searchParent !== 'function' || typeof fine.getFirstChild !== 'function' || typeof fine.getChildNode !== 'function') return null;
    const instance = fine.searchParent(node, 'chat-line', 12, 0, false);
    // FFZ marks ChatLine instances _ffz_no_scan. Fine's tree search therefore
    // cannot descend from the component itself. Use its public child accessor
    // to start at the rendered child; never change FFZ's scan guard.
    const child = instance && fine.getFirstChild(instance);
    // A message on an ancestor or an inline reply cannot identify this host.
    if (!child || fine.getChildNode(child, 3, false) !== node) return null;
    const id = instance.props?.message?.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 512) return null;
    return `data-id:${id}`;
  } catch { return null; } // Missing wrappers/upstream changes use conservative DOM policy.
}
