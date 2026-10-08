// Deterministic inspected Fine/ChatLine contract; not upstream code.
(() => {
  const instances = new WeakMap();
  const fine = {
    searchParent: (node, name) => name === 'chat-line' ? instances.get(node) : null,
    getChildNode: instance => instance.node,
  };
  globalThis.fixtureBindMessage = (node, id) => {
    node.removeAttribute('data-id'); node.removeAttribute('data-a-target');
    node.className = 'chat-line__message'; node.dataset.roomId = 'same-room'; node.dataset.userId = 'same-user';
    const instance = { node, props: { message: { id } } };
    instances.set(node, instance); return instance;
  };
  globalThis.fixtureMessageInstances = nativeRoots.map((node, index) => fixtureBindMessage(node, `fixture-message-${index}`));
  globalThis.fixtureReplaceMessage = (index, id = fixtureMessageInstances[index].props.message.id) => {
    const previous = nativeRoots[index]; const replacement = previous.cloneNode(true);
    replacement.setAttribute('style', 'color:white;padding-left:24px;');
    fixtureMessageInstances[index] = fixtureBindMessage(replacement, id);
    previous.replaceWith(replacement); nativeRoots[index] = replacement;
    return replacement;
  };
  globalThis.FrankerFaceZ = { get: () => ({ resolve: name => name === 'site.fine' ? fine : null }) };
  globalThis.fixtureFine = fine;
})();
