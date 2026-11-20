/**
 * Compile a pack's `components` rules into a marker-context provider.
 *
 * Each rule finds its nearest matching fiber in the probed ancestry. A rule of
 * a new kind becomes that kind's boundary; an `error` rule enriches the core
 * error boundary instead. Earlier rules win when two rules share a kind.
 * The pack's `labels` rules (./labels) become the provider's `label`.
 */

import { type Fiber, getDisplayName } from '../../layout-lab/fiber-walk';
import type { ContextContribution, ContextField, ContextProvider } from '../../layout-lab/marker-context';
import { compileLabels } from './labels';
import type { ChippyPack, PackComponentRule, PackValueRef } from './spec';

type CompiledRule = {
  rule: PackComponentRule;
  matches(name: string): boolean;
};

type Hit = { rule: PackComponentRule; fiber: Fiber; name: string; distance: number };

function displayNameOf(fiber: Fiber): string | null {
  return getDisplayName(fiber.type) || getDisplayName(fiber.elementType) || null;
}

function compileRule(rule: PackComponentRule): CompiledRule {
  const names = new Set(rule.match.names ?? []);
  const pattern = rule.match.pattern ? new RegExp(rule.match.pattern) : null;
  return { rule, matches: (name) => names.has(name) || !!pattern?.test(name) };
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Resolve a value reference against one matched fiber. */
export function readRef(ref: PackValueRef, hit: { rule: Pick<PackComponentRule, 'nameParts'>; fiber: Fiber; name: string }): string | null {
  for (const one of Array.isArray(ref) ? ref : [ref]) {
    let value: string | null = null;
    if (one === 'name') value = hit.name;
    else if (one.startsWith('props.')) value = scalar(hit.fiber.memoizedProps?.[one.slice(6)]);
    else if (one.startsWith('parts.') && hit.rule.nameParts) {
      const { separator, keys } = hit.rule.nameParts;
      const index = keys.indexOf(one.slice(6));
      value = index >= 0 ? scalar(hit.name.split(separator)[index]) : null;
    }
    if (value) return value;
  }
  return null;
}

function readData(hit: Hit): Record<string, string | null> {
  const out: Record<string, string | null> = { componentName: hit.name };
  for (const [key, ref] of Object.entries(hit.rule.data ?? {})) out[key] = readRef(ref, hit);
  return out;
}

function readFields(hit: Hit): ContextField[] {
  const out: ContextField[] = [];
  for (const field of hit.rule.fields ?? []) {
    const value = readRef(field.value, hit);
    if (value) out.push({ label: field.label, value });
  }
  return out;
}

export function compileComponents(pack: ChippyPack): ContextProvider | null {
  const rules = (pack.components ?? []).map(compileRule);
  const labeler = compileLabels(pack.labels);
  if (rules.length === 0 && !labeler) return null;
  const kinds = new Map<string, { kind: string; label: string; accent?: string }>();
  for (const { rule } of rules) {
    if (rule.kind === 'error' || kinds.has(rule.kind)) continue;
    kinds.set(rule.kind, { kind: rule.kind, label: rule.label ?? rule.kind, ...(rule.accent && { accent: rule.accent }) });
  }

  function nearest(fibers: Fiber[]): Hit[] {
    const hits: Array<Hit | null> = rules.map(() => null);
    let open = rules.length;
    for (let distance = 0; distance < fibers.length && open > 0; distance += 1) {
      const name = displayNameOf(fibers[distance]);
      if (!name) continue;
      rules.forEach((compiled, index) => {
        if (hits[index] || !compiled.matches(name)) return;
        hits[index] = { rule: compiled.rule, fiber: fibers[distance], name, distance };
        open -= 1;
      });
    }
    return hits.filter((hit): hit is Hit => !!hit);
  }

  function matchBoundary(fiber: Fiber): string | null {
    const name = displayNameOf(fiber);
    if (!name) return null;
    const hit = rules.find(({ rule, matches }) => rule.kind !== 'error' && matches(name));
    return hit ? hit.rule.kind : null;
  }

  return {
    id: pack.id,
    kinds: [...kinds.values()],
    describe(fibers) {
      const hits = nearest(fibers);
      const contribution: ContextContribution & {
        boundaries: NonNullable<ContextContribution['boundaries']>;
        titles: Record<string, string>;
        fields: Record<string, ContextField[]>;
      } = { boundaries: {}, titles: {}, fields: {} };
      for (const kind of kinds.keys()) contribution.boundaries[kind] = null;
      let showError = false;
      for (const hit of hits) {
        const { kind } = hit.rule;
        showError ||= !!hit.rule.showError;
        const claimed = kind === 'error' ? contribution.errorEnrichment !== undefined : !!contribution.boundaries[kind];
        if (claimed) continue;
        if (kind === 'error') {
          // A rule without data (a fallback marker) only contributes its title.
          if (hit.rule.data) contribution.errorEnrichment = readData(hit);
        } else {
          contribution.boundaries[kind] = { distance: hit.distance, ...readData(hit) };
        }
        const title = hit.rule.title ? readRef(hit.rule.title, hit) : null;
        if (title && !contribution.titles[kind]) contribution.titles[kind] = title;
        const fields = readFields(hit);
        if (fields.length && !contribution.fields[kind]) contribution.fields[kind] = fields;
      }
      if (hits.length === 0) return { boundaries: contribution.boundaries };
      return { ...contribution, ...(showError && { showError }) };
    },
    matchBoundary,
    ...(labeler && {
      // A component of one of this pack's kinds is labelled by that kind's rules.
      label: (fiber: Fiber, kind: string) => labeler(fiber, kind === 'component' ? matchBoundary(fiber) ?? kind : kind),
    }),
  };
}
