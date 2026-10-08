/** Read through FFZ's inspected Fine API; never scan React internals ourselves. */
export function twitchRendererIdentity(node) {
  try {
    const engine = globalThis.FrankerFaceZ?.get?.();
    const fine = engine?.resolve?.('site.fine');
    if (typeof fine?.searchParent !== 'function' || typeof fine.getChildNode !== 'function') return null;
    const instance = fine.searchParent(node, 'chat-line', 12, 0, false);
    // A message on an ancestor or an inline reply cannot identify this host.
    if (!instance || fine.getChildNode(instance, 3, false) !== node) return null;
    const id = instance.props?.message?.id;
    if (typeof id !== 'string' || !id.trim() || id.length > 512) return null;
    return `data-id:${id}`;
  } catch { return null; } // Missing wrappers/upstream changes use conservative DOM policy.
}
