/* eslint-disable */
(function installInspectReact(global) {
  const chippy = global.__CHIPPY = global.__CHIPPY || {};
  // Always reinstall — guards caused stale code to win after extension reload.

  function getReactInternalKeys(node) {
    if (!node) {
      return [];
    }

    return Object.getOwnPropertyNames(node).filter(
      (key) =>
        key.startsWith('__reactFiber$') ||
        key.startsWith('__reactProps$') ||
        key.startsWith('__reactContainer$'),
    );
  }

  function getFiberFromNode(node) {
    if (!node) {
      return null;
    }

    const fiberKey = getReactInternalKeys(node).find((key) => key.startsWith('__reactFiber$'));
    const containerKey = getReactInternalKeys(node).find((key) => key.startsWith('__reactContainer$'));

    return node[fiberKey] || node[containerKey] || null;
  }

  function getClosestFiber(node) {
    let current = node;

    while (current) {
      const fiber = getFiberFromNode(current);
      if (fiber) {
        return fiber;
      }
      current = current.parentNode || current.host || null;
    }

    return null;
  }

  function getDisplayName(type) {
    if (!type) {
      return null;
    }
    if (typeof type === 'string') {
      return type;
    }
    return type.displayName || type.name || type.render?.displayName || type.render?.name || 'Anonymous';
  }

  function normalizeSource(source) {
    if (!source) {
      return null;
    }

    return {
      fileName: source.fileName || null,
      lineNumber: source.lineNumber || null,
      columnNumber: source.columnNumber || null,
    };
  }

  function sourceOf(fiber) {
    const describeFiberSource = global.__AVALANCHE__?.layoutLab?.describeFiberSource;
    return typeof describeFiberSource === 'function'
      ? describeFiberSource(fiber)
      : normalizeSource(fiber?._debugSource || fiber?.type?._debugSource || null);
  }

  function describeFiber(fiber) {
    if (!fiber) {
      return null;
    }

    return {
      key: fiber.key ?? null,
      tag: fiber.tag ?? null,
      index: fiber.index ?? null,
      elementType: getDisplayName(fiber.elementType),
      type: getDisplayName(fiber.type),
      stateNodeType:
        fiber.stateNode && fiber.stateNode.nodeType === 1
          ? fiber.stateNode.tagName.toLowerCase()
          : typeof fiber.stateNode,
      debugSource: sourceOf(fiber),
      memoizedPropsKeys: fiber.memoizedProps ? Object.keys(fiber.memoizedProps) : [],
    };
  }

  function isCompositeFiber(fiber) {
    if (!fiber) {
      return false;
    }

    const name = getDisplayName(fiber.type);
    return Boolean(name && typeof fiber.type !== 'string');
  }

  function getOwnerChain(fiber) {
    const owners = [];
    let current = fiber ? fiber._debugOwner : null;

    while (current) {
      owners.push(describeFiber(current));
      current = current._debugOwner || null;
    }

    return owners;
  }

  function getReturnChain(fiber) {
    const parents = [];
    let current = fiber ? fiber.return : null;

    while (current) {
      parents.push(describeFiber(current));
      current = current.return || null;
    }

    return parents;
  }

  function getNearestCompositeFiber(fiber) {
    let current = fiber;

    while (current) {
      if (isCompositeFiber(current)) {
        return current;
      }
      current = current.return || null;
    }

    return null;
  }


  function getNearestTestIdParent(node) {
    // Walk includes the node itself — if the probed element has data-testid, that wins.
    let current = node || null;
    while (current) {
      const testId = current.dataset ? current.dataset.testid : null;
      if (testId) {
        const fiber = getFiberFromNode(current) || getClosestFiber(current);
        const componentFiber = getNearestCompositeFiber(fiber);
        return {
          testId,
          tagName: current.tagName ? current.tagName.toLowerCase() : null,
          component: describeFiber(componentFiber),
          fiber: describeFiber(fiber),
        };
      }
      current = current.parentElement || null;
    }
    return null;
  }

  function inspectNode(node) {
    const fiber = getFiberFromNode(node) || getClosestFiber(node);
    const componentFiber = getNearestCompositeFiber(fiber);

    return {
      dom: node
        ? {
            tagName: node.tagName ? node.tagName.toLowerCase() : null,
            text: node.textContent?.trim() || '',
            reactKeys: getReactInternalKeys(node),
          }
        : null,
      fiber: describeFiber(fiber),
      component: describeFiber(componentFiber),
      owners: getOwnerChain(componentFiber || fiber),
      returns: getReturnChain(componentFiber || fiber),
      nearestTestIdParent: getNearestTestIdParent(node),
    };
  }

  function findByText(text, root = document) {
    return Array.from(root.querySelectorAll('*'))
      .filter((node) => node.textContent?.trim() === text)
      .map((node) => ({
        node,
        inspection: inspectNode(node),
      }));
  }

  function findBySelector(selector, root = document) {
    return Array.from(root.querySelectorAll(selector)).map((node) => ({
      node,
      inspection: inspectNode(node),
    }));
  }

  function inspectAtPoint(x, y) {
    return document.elementsFromPoint(x, y).map((node) => ({
      node,
      inspection: inspectNode(node),
    }));
  }

  chippy.inspectReact = {
    getReactInternalKeys,
    getFiberFromNode,
    getClosestFiber,
    getNearestCompositeFiber,
    describeFiber,
    getOwnerChain,
    getReturnChain,
    inspectNode,
    inspectAtPoint,
    findByText,
    findBySelector,
  };
})(window);
