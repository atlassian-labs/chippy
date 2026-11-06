/* eslint-disable */
(function installResolveProbes(global) {
  const chippy = global.__CHIPPY = global.__CHIPPY || {};
  // Always reinstall — guards caused stale code to win after extension reload.

  // ─── Source confidence ────────────────────────────────────────────────────
  // In a dev build React <=18 exposes _debugSource; React 19 exposes
  // _debugStack, which the bundled resolver turns into a source location.
  // In a production build neither exists — we only have component function
  // names from fiber.type, which may also be minified.
  //
  // Every resolved probe carries a `confidence` field:
  //   "dev"         — React development source evidence is present
  //   "production"  — no _debugSource, component names only (may be minified)
  //   "unknown"     — could not determine anything useful

  function sourceConfidence(source, owners) {
    if (source?.fileName) return 'dev';
    if (owners?.some((o) => o?.source?.fileName)) return 'dev';
    return 'production';
  }

  function summarizeSource(source) {
    if (!source) return null;
    return {
      fileName: source.fileName || null,
      lineNumber: source.lineNumber || null,
      columnNumber: source.columnNumber || null,
    };
  }

  function summarizeChainEntry(entry) {
    if (!entry) return null;
    return {
      name: entry.name || null,
      key: entry.key ?? null,
      source: summarizeSource(entry.source),
      // props from layout-lab getOwnerChain/getReturnComponentChain are already key arrays
      propNames: Array.isArray(entry.props)
        ? entry.props.filter((k) => k !== 'children')
        : (entry.props && typeof entry.props === 'object' ? listPropNames(entry.props) : []),
      hookCount: entry.hookCount ?? null,
      hookCountTruncated: entry.hookCountTruncated ?? false,
      hookCountMax: entry.hookCountMax ?? null,
      complexityNote: typeof entry.hookCount === 'number' && entry.hookCount >= 40
        ? 'High enough hook count to inspect carefully before changing local logic.'
        : null,
    };
  }

  function summarizeProps(props) {
    if (!props || typeof props !== 'object') return {};
    return Object.entries(props)
      .filter(([k]) => !['children', 'style', 'className'].includes(k))
      .reduce((acc, [k, v]) => {
        if (v == null) { acc[k] = v; return acc; }
        if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
          acc[k] = v; return acc;
        }
        if (Array.isArray(v)) { acc[k] = `[array:${v.length}]`; return acc; }
        if (typeof v === 'function') { acc[k] = '[function]'; return acc; }
        acc[k] = v?.id || v?.key || v?.name || '[object]';
        return acc;
      }, {});
  }

  // List all prop names (excluding children) for a props object — used for compact snapshot
  function listPropNames(props) {
    if (!props || typeof props !== 'object') return [];
    return Object.keys(props).filter((k) => k !== 'children');
  }

  // ─── Full probe summary ───────────────────────────────────────────────────

  function summarizeProbe(probe) {
    const best = probe?.probe?.best;
    return {
      dom: {
        tag: best?.exact?.domTag,
        text: best?.exact?.domText,
        fiberType: best?.exact?.fiberType,
        source: best?.exact?.source,
      },
      component: {
        name: best?.component?.name,
        key: best?.component?.key ?? null,
        props: best?.component?.props,
        propNames: listPropNames(best?.component?.props),
        hookCount: best?.component?.hookCount ?? null,
        hookCountTruncated: best?.component?.hookCountTruncated ?? false,
        hookCountMax: best?.component?.hookCountMax ?? null,
        complexityNote: typeof best?.component?.hookCount === 'number' && best.component.hookCount >= 40
          ? 'High enough hook count to inspect carefully before changing local logic.'
          : null,
        source: best?.component?.source,
        ownerStackKind: best?.component?.ownerStackKind || null,
        owners: best?.component?.owners,
        parents: best?.component?.parents,
      },
    };
  }

  // ─── Compact probe summary (used by bridge for publishing) ────────────────

  function compactProbeSummary(probe) {
    const best = probe?.probe?.best;

    const componentSource = summarizeSource(best?.component?.source);
    // describeComponent already falls back to component parents when the
    // build records no debug owners, and labels the chain in ownerStackKind.
    const owners = (best?.component?.owners || []).map(summarizeChainEntry);
    const ownerStackKind = best?.component?.ownerStackKind || null;
    const parents = (best?.component?.parents || []).map(summarizeChainEntry);
    const confidence = sourceConfidence(componentSource, owners);

    // Matched CSS rules — rules from all sheets whose selector matches the target element
    const targetEl = probe?.probe?._targetEl || null;
    const inspectedTarget = targetEl ? chippy.inspectReact?.inspectNode?.(targetEl) : null;
    const nearestTestId = inspectedTarget?.nearestTestIdParent?.testId || null;
    const matchedStyles = [];
    if (targetEl) {
      try {
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules; } catch { continue; }
          for (const rule of rules) {
            if (rule instanceof CSSStyleRule) {
              try {
                if (targetEl.matches(rule.selectorText)) {
                  matchedStyles.push({
                    selector: rule.selectorText,
                    declarations: rule.style.cssText,
                    source: sheet.href || 'inline',
                  });
                }
              } catch { /* invalid selector — skip */ }
            }
          }
        }
      } catch { /* sheet access failed */ }
    }

    // DOM parent chain — walk up to 10 parentElement levels from the target element
    const domParents = [];
    if (targetEl) {
      let el = targetEl.parentElement;
      while (el && domParents.length < 10) {
        const cls = el.className && typeof el.className === 'string'
          ? el.className.trim().split(/\s+/).slice(0, 3).join(' ')
          : null;
        domParents.push({
          tag: el.tagName?.toLowerCase() || null,
          id: el.id || null,
          className: cls || null,
        });
        el = el.parentElement;
      }
    }

    return {
      nearestTestId,
      confidence,
      dom: {
        tag: best?.exact?.domTag || null,
        text: (best?.exact?.domText || '').slice(0, 80),
        fiberType: best?.exact?.fiberType || null,
        source: summarizeSource(best?.exact?.source),
        parents: domParents,
        matchedStyles,
      },
      component: {
        name: best?.component?.name || null,
        key: best?.component?.key ?? null,
        propNames: listPropNames(best?.component?.props),
        props: summarizeProps(best?.component?.props),
        hookCount: best?.component?.hookCount ?? null,
        hookCountTruncated: best?.component?.hookCountTruncated ?? false,
        hookCountMax: best?.component?.hookCountMax ?? null,
        complexityNote: typeof best?.component?.hookCount === 'number' && best.component.hookCount >= 40
          ? 'High enough hook count to inspect carefully before changing local logic.'
          : null,
        source: componentSource,
        ownerStackKind,
        owners,
        // Without development source metadata, the component parent chain is
        // the best available component stack.
        componentStack: confidence !== 'dev'
          ? parents.map((entry) => ({ name: entry.name, key: entry.key, source: entry.source }))
          : null,
        parents,
      },
      // Human-readable note about what is and isn't available
      note: confidence === 'dev'
        ? null
        : confidence === 'production'
          ? 'Production build: no React development source metadata is available. Component names may be minified and source locations are unavailable. Owners fall back to the component parent chain (ownerStackKind: parents); use names, props, test IDs, and that chain.'
          : 'Could not determine build mode. Probe data may be incomplete.',
    };
  }

  // ─── Cross-source correlation hint ───────────────────────────────────────
  // When one probe is on a dev page and another is on a production page
  // pointing at "around the same component", the agent can use this to
  // try to match names across the two.


  function componentIdentity(entry) {
    if (!entry) return null;
    const src = entry.source || null;
    const srcKey = src && src.fileName ? `${src.fileName}:${src.lineNumber || 0}:${src.columnNumber || 0}` : '';
    return `${entry.name || ''}|${entry.key ?? ''}|${srcKey}`;
  }

  function ancestryForSummary(summary) {
    if (!summary?.component) return [];
    const out = [];
    out.push({
      name: summary.component.name || null,
      key: summary.component.key ?? null,
      source: summary.component.source || null,
      propNames: summary.component.propNames || [],
      hookCount: summary.component.hookCount ?? null,
      hookCountTruncated: summary.component.hookCountTruncated ?? false,
      hookCountMax: summary.component.hookCountMax ?? null,
      complexityNote: summary.component.complexityNote || null,
    });
    for (const parent of summary.component.parents || []) out.push(parent);
    return out.filter(Boolean);
  }

  function findCommonParent(summaries) {
    const ids = Object.keys(summaries).filter((id) => !id.startsWith('__') && summaries[id]?.component);
    if (ids.length < 2) return null;
    const chains = ids.map((id) => ancestryForSummary(summaries[id]));
    if (chains.some((c) => c.length === 0)) return null;
    const otherSets = chains.slice(1).map((chain) => new Set(chain.map(componentIdentity).filter(Boolean)));
    for (const entry of chains[0]) {
      const id = componentIdentity(entry);
      if (!id) continue;
      if (otherSets.every((set) => set.has(id))) {
        return {
          confidence: 'dev',
          dom: null,
          component: {
            name: entry.name || null,
            key: entry.key ?? null,
            propNames: entry.propNames || [],
            props: {},
            hookCount: entry.hookCount ?? null,
            hookCountTruncated: entry.hookCountTruncated ?? false,
            hookCountMax: entry.hookCountMax ?? null,
            complexityNote: entry.complexityNote || null,
            source: entry.source || null,
            owners: [],
            componentStack: null,
            parents: [],
          },
          note: `Nearest common parent for probes ${ids.join(', ')}.`,
        };
      }
    }
    return null;
  }

  function correlatePairs(summaries) {
    const ids = Object.keys(summaries);
    const devProbes = ids.filter((id) => summaries[id]?.confidence === 'dev');
    const prodProbes = ids.filter((id) => summaries[id]?.confidence === 'production');
    if (devProbes.length === 0 || prodProbes.length === 0) return null;

    const hints = [];
    for (const devId of devProbes) {
      for (const prodId of prodProbes) {
        const devName = summaries[devId]?.component?.name;
        const prodName = summaries[prodId]?.component?.name;
        hints.push({
          devProbe: devId,
          productionProbe: prodId,
          devComponentName: devName || null,
          productionComponentName: prodName || null,
          note: devName && prodName && devName === prodName
            ? `Component names match ("${devName}") — likely the same component.`
            : devName && prodName
              ? `Component names differ ("${devName}" vs "${prodName}") — may still be the same component if production is minified. Check component stack for structural similarity.`
              : 'Could not compare — one or both probes have no component name.',
        });
      }
    }
    return hints.length > 0 ? hints : null;
  }

  // ─── Public API ───────────────────────────────────────────────────────────

  function resolveProbes(...ids) {
    const result = {};
    for (const id of ids) {
      const probe = chippy.layoutLab?.getMarkerProbe(id);
      result[id] = probe ? summarizeProbe(probe) : null;
    }
    return result;
  }

  function resolveProbesCompact(...ids) {
    const result = {};
    for (const id of ids) {
      const probe = chippy.layoutLab?.getMarkerProbe(id);
      result[id] = probe ? compactProbeSummary(probe) : null;
    }
    const crossSourceHints = correlatePairs(result);
    if (crossSourceHints) result.__crossSourceHints = crossSourceHints;
    const commonParent = findCommonParent(result);
    if (commonParent) result.__commonParent = commonParent;
    return result;
  }

  chippy.resolveProbes = resolveProbes;
  chippy.resolveProbesCompact = resolveProbesCompact;
})(window);
