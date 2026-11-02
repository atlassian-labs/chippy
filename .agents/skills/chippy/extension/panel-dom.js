/* eslint-disable */
(function installChippyPanelDom(global) {
  function nodeKey(node) {
    return node?.nodeType === 1 ? node.getAttribute('data-chippy-key') : null;
  }

  function canPatch(current, next) {
    if (!current || !next || current.nodeType !== next.nodeType) return false;
    if (current.nodeType === 1 && current.tagName !== next.tagName) return false;
    const currentKey = nodeKey(current);
    const nextKey = nodeKey(next);
    return currentKey || nextKey ? currentKey === nextKey : true;
  }

  function syncAttributes(current, next) {
    Array.from(current.attributes).forEach((attribute) => {
      if (!next.hasAttribute(attribute.name)) current.removeAttribute(attribute.name);
    });
    Array.from(next.attributes).forEach((attribute) => {
      if (current.getAttribute(attribute.name) !== attribute.value) {
        current.setAttribute(attribute.name, attribute.value);
      }
    });
  }

  function patchNode(current, next) {
    if (current.nodeType === 3 || current.nodeType === 8) {
      if (current.data !== next.data) current.data = next.data;
      return;
    }
    if (current.nodeType !== 1) return;

    const tagName = current.tagName;
    const preservesValue = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
    const value = preservesValue ? current.value : null;
    const checked = tagName === 'INPUT' ? current.checked : null;

    syncAttributes(current, next);
    patchChildNodes(current, next);

    // Probe annotations are drafts until Attach is clicked. Rendering new
    // runtime evidence must not overwrite an in-progress value.
    if (preservesValue) current.value = value;
    if (tagName === 'INPUT') current.checked = checked;
  }

  function patchChildNodes(currentParent, nextParent) {
    const currentChildren = Array.from(currentParent.childNodes);
    const keyed = new Map(
      currentChildren
        .map((node) => [nodeKey(node), node])
        .filter(([key]) => Boolean(key)),
    );
    const used = new Set();
    let cursor = currentParent.firstChild;

    Array.from(nextParent.childNodes).forEach((nextChild) => {
      const key = nodeKey(nextChild);
      let current = key ? keyed.get(key) : null;

      while (cursor && used.has(cursor)) cursor = cursor.nextSibling;
      if (!current && cursor && !nodeKey(cursor) && canPatch(cursor, nextChild)) current = cursor;

      if (current && canPatch(current, nextChild)) {
        if (current !== cursor) currentParent.insertBefore(current, cursor);
        patchNode(current, nextChild);
      } else {
        current = nextChild.cloneNode(true);
        currentParent.insertBefore(current, cursor);
      }

      used.add(current);
      cursor = current.nextSibling;
    });

    Array.from(currentParent.childNodes).forEach((child) => {
      if (used.has(child)) return;
      if (child.nodeType === 1 && child.hasAttribute('data-chippy-preserve')) return;
      child.remove();
    });
  }

  function patchChildren(target, html) {
    const template = target.ownerDocument.createElement('template');
    template.innerHTML = html;
    patchChildNodes(target, template.content);
  }

  global.__CHIPPY_PANEL_DOM__ = { patchChildren };
})(window);
