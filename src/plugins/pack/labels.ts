/**
 * Compile a pack's `labels` rules into a fiber labeler: the application's own
 * name for a boundary or component, read from the fiber's props, from a
 * marker component above it, or from one below it (see PackLabelRule).
 */

import { type Fiber, getDisplayName } from '../../layout-lab/fiber-walk';
import { readRef } from './components';
import type { PackLabelRule } from './spec';

export type FiberLabeler = (fiber: Fiber, kind: string) => string | null;

const SUSPENSE_TAG = 13;
const DEFAULT_WITHIN = 3;
/** Bounds a `children` search in wide subtrees; `within` bounds its depth. */
const MAX_CHILD_VISITS = 200;

type CompiledLabel = {
  rule: PackLabelRule;
  matches(name: string): boolean;
};

/** The display name a rule matches: components and Suspense; host and unnamed fibers have none. */
export function labelNameOf(fiber: Fiber): string | null {
  if (typeof fiber.type === 'string') return null;
  const name = getDisplayName(fiber.type) || getDisplayName(fiber.elementType);
  if (name) return name;
  return (fiber as { tag?: number }).tag === SUSPENSE_TAG ? 'Suspense' : null;
}

function compile(rule: PackLabelRule): CompiledLabel {
  if (!rule.match) return { rule, matches: () => true };
  const names = new Set(rule.match.names ?? []);
  const pattern = rule.match.pattern ? new RegExp(rule.match.pattern) : null;
  return { rule, matches: (name) => names.has(name) || !!pattern?.test(name) };
}

function read(compiled: CompiledLabel, fiber: Fiber, name: string | null): string | null {
  if (name === null) {
    if (compiled.rule.match) return null;
  } else if (!compiled.matches(name)) return null;
  return readRef(compiled.rule.value, { rule: compiled.rule, fiber, name: name ?? '' });
}

function fromParents(compiled: CompiledLabel, fiber: Fiber): string | null {
  const within = compiled.rule.within ?? DEFAULT_WITHIN;
  let seen = 0;
  for (let node = fiber.return; node && seen < within; node = node.return) {
    const name = labelNameOf(node);
    if (!name) continue;
    seen += 1;
    const value = read(compiled, node, name);
    if (value) return value;
  }
  return null;
}

function fromChildren(compiled: CompiledLabel, fiber: Fiber): string | null {
  const within = compiled.rule.within ?? DEFAULT_WITHIN;
  // Depth-first, nearest subtree first; depth counts named components only.
  const stack: Array<{ node: Fiber; depth: number }> = [];
  for (let child = fiber.child; child; child = child.sibling) stack.push({ node: child, depth: 0 });
  stack.reverse();
  let visits = 0;
  while (stack.length && visits++ < MAX_CHILD_VISITS) {
    const { node, depth } = stack.pop()!;
    const name = labelNameOf(node);
    const here = name ? depth + 1 : depth;
    if (name) {
      const value = read(compiled, node, name);
      if (value) return value;
    }
    if (here >= within) continue;
    const children: Fiber[] = [];
    for (let child = node.child; child; child = child.sibling) children.push(child);
    for (let index = children.length - 1; index >= 0; index -= 1) stack.push({ node: children[index], depth: here });
  }
  return null;
}

function apply(compiled: CompiledLabel, fiber: Fiber): string | null {
  const from = compiled.rule.from ?? 'self';
  if (from === 'parents') return fromParents(compiled, fiber);
  if (from === 'children') return fromChildren(compiled, fiber);
  return read(compiled, fiber, labelNameOf(fiber));
}

/** Returns null when there are no rules, so a pack without labels adds nothing. */
export function compileLabels(rules: PackLabelRule[] | undefined): FiberLabeler | null {
  if (!rules?.length) return null;
  const byKind = new Map<string, CompiledLabel[]>();
  for (const rule of rules) {
    const list = byKind.get(rule.for) ?? [];
    list.push(compile(rule));
    byKind.set(rule.for, list);
  }
  return (fiber, kind) => {
    for (const compiled of byKind.get(kind) ?? []) {
      const value = apply(compiled, fiber);
      if (value) return value;
    }
    return null;
  };
}
