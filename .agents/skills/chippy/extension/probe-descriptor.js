/* eslint-disable */
(function installProbeDescriptor(global) {
  const chippy = global.__CHIPPY = global.__CHIPPY || {};

  function normalizeText(value, max = 200) {
    return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max) || null;
  }

  function stableAttrs(node) {
    if (!node || node.nodeType !== 1) return {};
    const attrs = {};
    const names = ['data-testid', 'role', 'aria-label', 'name', 'id', 'title', 'href', 'type'];
    for (const name of names) {
      const value = node.getAttribute?.(name);
      if (value) attrs[name] = value;
    }
    return attrs;
  }

  function siblingIndex(node) {
    if (!node?.parentElement) return 0;
    const tag = node.tagName;
    let index = 0;
    for (const sibling of node.parentElement.children) {
      if (sibling === node) return index;
      if (sibling.tagName === tag) index += 1;
    }
    return index;
  }

  function ownerNames(fiber, max = 8) {
    const names = [];
    let owner = fiber?._debugOwner || null;
    while (owner && names.length < max) {
      const name = chippy.getDisplayName?.(owner.type) || owner.type?.displayName || owner.type?.name || null;
      if (name) names.push(name);
      owner = owner._debugOwner || null;
    }
    return names;
  }

  function describeSource(source) {
    if (!source?.fileName) return null;
    return {
      fileName: source.fileName,
      lineNumber: Number(source.lineNumber || 0) || null,
      columnNumber: Number(source.columnNumber || 0) || null,
    };
  }

  function getNearestTestId(node) {
    return chippy.getNearestTestIdParent?.(node) || null;
  }

  function captureProbeDescriptor(target) {
    const node = target?.nodeType === 1 ? target : null;
    if (!node) return { ok: false, error: 'Target element is required' };

    const inspection = chippy.inspectNode ? chippy.inspectNode(node) : null;
    const component = inspection?.component || null;
    const fiber = chippy.getClosestFiber ? chippy.getClosestFiber(node) : null;
    const source = component?.source || describeSource(fiber?._debugSource || fiber?.type?._debugSource || null);
    const descriptor = {
      dom: {
        tag: node.tagName?.toLowerCase() || null,
        attrs: stableAttrs(node),
        text: normalizeText(node.innerText || node.textContent || ''),
        nearestTestId: getNearestTestId(node),
        siblingIndex: siblingIndex(node),
      },
      component: {
        name: component?.name || chippy.getDisplayName?.(fiber?.type) || fiber?.type?.displayName || fiber?.type?.name || null,
        source,
        ownerNames: ownerNames(fiber),
      },
    };
    const hasIdentity = !!(
      descriptor.dom.nearestTestId
      || descriptor.component.name
      || descriptor.component.source?.fileName
      || Object.keys(descriptor.dom.attrs).length
      || descriptor.dom.text
    );
    if (!hasIdentity) {
      return { ok: false, error: 'Target does not expose stable identity yet', descriptor };
    }
    return { ok: true, descriptor };
  }

  function sourceKey(source) {
    if (!source?.fileName) return null;
    return [source.fileName, source.lineNumber || '', source.columnNumber || ''].join(':');
  }

  function elementFromFiber(fiber) {
    const node = fiber?.stateNode;
    return node && node.nodeType === 1 ? node : null;
  }

  function candidateFromNode(node, providedFiber) {
    const fiber = providedFiber || (chippy.getClosestFiber ? chippy.getClosestFiber(node) : null);
    const inspection = chippy.inspectNode ? chippy.inspectNode(node) : null;
    const component = inspection?.component || null;
    return {
      node,
      dom: {
        tag: node.tagName?.toLowerCase() || null,
        attrs: stableAttrs(node),
        text: normalizeText(node.innerText || node.textContent || ''),
        nearestTestId: getNearestTestId(node),
        siblingIndex: siblingIndex(node),
      },
      component: {
        name: component?.name || chippy.getDisplayName?.(fiber?.type) || fiber?.type?.displayName || fiber?.type?.name || null,
        source: component?.source || describeSource(fiber?._debugSource || fiber?.type?._debugSource || null),
        ownerNames: ownerNames(fiber),
      },
      fiber,
    };
  }

  function getFiberCandidates(descriptor, limit = 250) {
    const findFibers = chippy.pageBridge?.helpers?.findFibers;
    if (typeof findFibers !== 'function') return [];
    const seen = new Set();
    const fibers = findFibers((fiber) => {
      const node = elementFromFiber(fiber);
      if (!node) return false;
      const name = chippy.getDisplayName?.(fiber?.type) || fiber?.type?.displayName || fiber?.type?.name || null;
      const source = describeSource(fiber?._debugSource || fiber?.type?._debugSource || null);
      const testId = getNearestTestId(node);
      if (descriptor.component.source?.fileName && sourceKey(source) === sourceKey(descriptor.component.source)) return true;
      if (descriptor.component.name && name === descriptor.component.name) return true;
      if (descriptor.dom.nearestTestId && testId === descriptor.dom.nearestTestId) return true;
      if (descriptor.dom.text) {
        const text = normalizeText(node.innerText || node.textContent || '');
        if (text && (text.includes(descriptor.dom.text) || descriptor.dom.text.includes(text))) return true;
      }
      return false;
    }, { max: limit });
    for (const fiber of fibers) {
      const node = elementFromFiber(fiber);
      if (!node || seen.has(node)) continue;
      seen.add(node);
    }
    return Array.from(seen).map((node) => candidateFromNode(node));
  }

  function getDomCandidates(root) {
    return Array.from(root.querySelectorAll('*')).map((node) => candidateFromNode(node));
  }

  function scoreCandidate(descriptor, candidate) {
    const matches = {};
     let strict = true;
    let score = 0;

    function match(name, condition, weight, strictField = false) {
      matches[name] = !!condition;
      if (condition) score += weight;
      if (strictField && !condition) strict = false;
    }

    match('nearestTestId', !descriptor.dom.nearestTestId || descriptor.dom.nearestTestId === candidate.dom.nearestTestId, 5, !!descriptor.dom.nearestTestId);
    match('componentName', !descriptor.component.name || descriptor.component.name === candidate.component.name, 4, !!descriptor.component.name);
    match('componentSource', !sourceKey(descriptor.component.source) || sourceKey(descriptor.component.source) === sourceKey(candidate.component.source), 6, !!sourceKey(descriptor.component.source));
    match('tag', !descriptor.dom.tag || descriptor.dom.tag === candidate.dom.tag, 2);

    const textMatch = descriptor.dom.text && candidate.dom.text
      ? candidate.dom.text.includes(descriptor.dom.text) || descriptor.dom.text.includes(candidate.dom.text)
      : !descriptor.dom.text;
    match('text', textMatch, 2);

    const ownerNames = descriptor.component.ownerNames || [];
    const candidateOwners = candidate.component.ownerNames || [];
    const ownerOverlap = ownerNames.length === 0 || ownerNames.every((name) => candidateOwners.includes(name));
    match('ownerNames', ownerOverlap, 3);

    const attrEntries = Object.entries(descriptor.dom.attrs || {});
    const attrsMatch = attrEntries.every(([name, value]) => candidate.dom.attrs?.[name] === value);
    match('attrs', attrsMatch, Math.min(4, attrEntries.length || 1));

    match('siblingIndex', descriptor.dom.siblingIndex == null || descriptor.dom.siblingIndex === candidate.dom.siblingIndex, 1);

    return { strict, score, matches };
  }

  function resolveProbeDescriptor(descriptor, options = {}) {
    if (!descriptor?.dom || !descriptor?.component) return { ok: false, error: 'Descriptor is required' };
    const root = options.root || document;
    const preferFiber = options.preferFiber !== false;
    const candidates = [];
    const seenKeys = new Set();
    const pools = [];
    if (preferFiber) pools.push({ kind: 'fiber', items: getFiberCandidates(descriptor, Number(options.fiberLimit || 250)) });
    pools.push({ kind: 'dom', items: getDomCandidates(root) });

    for (const pool of pools) {
      for (const candidate of pool.items) {
        const key = [candidate.component.name || '', sourceKey(candidate.component.source) || '', candidate.dom.nearestTestId || '', candidate.dom.tag || '', candidate.dom.text || '', candidate.dom.siblingIndex ?? ''].join('||');
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        const evaluation = scoreCandidate(descriptor, candidate);
        if (!evaluation.strict && evaluation.score < 5) continue;
        candidates.push({
          score: evaluation.score + (pool.kind === 'fiber' ? 2 : 0),
          strict: evaluation.strict,
          matches: evaluation.matches,
          dom: candidate.dom,
          component: candidate.component,
          node: candidate.node,
          fiber: candidate.fiber,
          candidateKind: pool.kind,
        });
      }
    }
    candidates.sort((a, b) => {
      if (a.strict !== b.strict) return a.strict ? -1 : 1;
      if (a.score !== b.score) return b.score - a.score;
      if (a.candidateKind !== b.candidateKind) return a.candidateKind === 'fiber' ? -1 : 1;
      return 0;
    });
    const best = candidates[0] || null;
    return {
      ok: !!best,
      best,
      candidates: candidates.slice(0, 5).map((candidate) => ({
        score: candidate.score,
        strict: candidate.strict,
        matches: candidate.matches,
        dom: candidate.dom,
        component: candidate.component,
        candidateKind: candidate.candidateKind,
      })),
      error: best ? null : 'No matching element found',
    };
  }

  chippy.captureProbeDescriptor = captureProbeDescriptor;
  chippy.resolveProbeDescriptor = resolveProbeDescriptor;
})(globalThis);
