/**
 * Page overlay for script results: outlined boxes over fibers, drawn in a
 * Chippy-owned layer that never touches the page's own DOM or layout.
 *
 * The layer is one fixed, pointer-transparent element marked `data-chippy-ui`,
 * with its boxes in a shadow root. Boxes follow their fibers on scroll, resize,
 * and once a second for commits, and disappear when their fiber unmounts.
 * Each `paint` call owns a named set of boxes, so `clear(id)` removes one set.
 */

import type { Rect } from '../component-area/area-grid';
import type { FiberKind, FiberRef } from './fiber-ref';

type Item = FiberRef | null | undefined;

export interface OverlayLayer {
  items: Item[];
  /** A CSS color, `kind` (default: one hue per fiber kind), or a function of the item. */
  color?: string | ((ref: FiberRef, index: number) => string);
  /** Label text; default is `ref.label`, then the fiber name. Return null for no label. */
  label?: string | ((ref: FiberRef, index: number) => string | null);
  /** Dashed outline; default dashes Suspense boundaries that show their fallback. */
  dashed?: boolean | ((ref: FiberRef, index: number) => boolean);
}

export interface PaintResult {
  ok: true;
  id: string;
  boxes: number;
  /** Items with no laid-out DOM (hidden, unmounted, or rendering nothing). */
  skipped: number;
}

interface Box {
  ref: FiberRef;
  color: string;
  label: string | null;
  dashed: boolean;
  /** Painted ancestors of this item, used to inset nested boxes that share an edge. */
  depth: number;
}

export interface OverlayDeps {
  boxOf: (ref: FiberRef) => Rect | null;
  isAncestor: (ancestor: FiberRef, of: FiberRef) => boolean;
  document?: Document;
}

const KIND_COLORS: Record<FiberKind, string> = {
  suspense: '#1D7AFC',
  error: '#E2483D',
  component: '#8270DB',
  host: '#22A06B',
  text: '#758195',
  portal: '#758195',
  other: '#758195',
};
const MAX_BOXES = 500;
const INSET_PX = 3;
const REFRESH_MS = 1000;

const sets = new Map<string, Box[]>();
let host: HTMLElement | null = null;
let layer: HTMLElement | null = null;
let frame = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let activeDeps: OverlayDeps | null = null;

function resolve<T>(value: T | ((ref: FiberRef, index: number) => T) | undefined, ref: FiberRef, index: number, fallback: T): T {
  if (value === undefined) return fallback;
  return typeof value === 'function' ? (value as (ref: FiberRef, index: number) => T)(ref, index) : value;
}

function schedule(): void {
  if (frame || typeof requestAnimationFrame !== 'function') return;
  frame = requestAnimationFrame(() => { frame = 0; render(); });
}

function mount(doc: Document): void {
  if (host && host.isConnected) return;
  host = doc.createElement('div');
  host.setAttribute('data-chippy-ui', 'true');
  host.setAttribute('data-chippy-overlay', 'true');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483646;contain:strict;';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = '<style>'
    + '.b{position:fixed;box-sizing:border-box;border:2px solid var(--c);background:color-mix(in srgb,var(--c) 7%,transparent);border-radius:2px}'
    + '.b.d{border-style:dashed}'
    + '.l{position:absolute;left:-2px;top:-2px;transform:translateY(-100%);max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;'
    + 'font:600 11px/16px system-ui,sans-serif;color:#fff;background:var(--c);padding:0 5px;border-radius:2px 2px 0 0}'
    + '.l.in{transform:none;border-radius:0 0 2px 0}'
    + '</style><div class="layer"></div>';
  layer = shadow.querySelector('.layer');
  doc.documentElement.appendChild(host);
  const view = doc.defaultView || window;
  view.addEventListener('scroll', schedule, { capture: true, passive: true });
  view.addEventListener('resize', schedule, { passive: true });
  timer = setInterval(render, REFRESH_MS);
}

function unmount(): void {
  const view = host?.ownerDocument?.defaultView || (typeof window !== 'undefined' ? window : null);
  view?.removeEventListener('scroll', schedule, { capture: true });
  view?.removeEventListener('resize', schedule);
  if (timer) clearInterval(timer);
  timer = null;
  if (frame && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame);
  frame = 0;
  host?.remove();
  host = null;
  layer = null;
}

function render(): void {
  if (!layer || !activeDeps) return;
  const doc = layer.ownerDocument;
  const fragment = doc.createDocumentFragment();
  for (const boxes of sets.values()) {
    for (const box of boxes) {
      const rect = safeBox(activeDeps, box.ref);
      if (!rect) continue;
      const inset = box.depth * INSET_PX;
      const el = doc.createElement('div');
      el.className = box.dashed ? 'b d' : 'b';
      el.style.setProperty('--c', box.color);
      el.style.left = rect.left + inset + 'px';
      el.style.top = rect.top + inset + 'px';
      el.style.width = Math.max(0, rect.right - rect.left - 2 * inset) + 'px';
      el.style.height = Math.max(0, rect.bottom - rect.top - 2 * inset) + 'px';
      if (box.label) {
        const label = doc.createElement('div');
        // Labels sit above the box unless that would leave the viewport or
        // collide with a parent's label on the same edge.
        label.className = rect.top + inset < 16 || box.depth > 0 ? 'l in' : 'l';
        label.textContent = box.label;
        el.appendChild(label);
      }
      fragment.appendChild(el);
    }
  }
  layer.replaceChildren(fragment);
}

/** A box that cannot be measured any more (its fiber is gone) is skipped, not fatal. */
function safeBox(deps: OverlayDeps, ref: FiberRef): Rect | null {
  try {
    return deps.boxOf(ref);
  } catch {
    return null;
  }
}

function safeAncestor(deps: OverlayDeps, ancestor: FiberRef, of: FiberRef): boolean {
  try {
    return deps.isAncestor(ancestor, of);
  } catch {
    return false;
  }
}

export function paintOverlay(layers: OverlayLayer | OverlayLayer[], options: { id?: string }, deps: OverlayDeps): PaintResult {
  const doc = deps.document || document;
  const id = String(options.id || 'default');
  const boxes: Box[] = [];
  let skipped = 0;
  for (const spec of Array.isArray(layers) ? layers : [layers]) {
    (spec.items || []).forEach((ref, index) => {
      if (!ref || boxes.length >= MAX_BOXES) { if (ref) skipped += 1; return; }
      if (!deps.boxOf(ref)) { skipped += 1; return; }
      boxes.push({
        ref,
        color: resolve(spec.color, ref, index, 'kind') === 'kind' ? KIND_COLORS[ref.kind] : resolve(spec.color, ref, index, 'kind'),
        label: resolve(spec.label, ref, index, ref.label ?? ref.name),
        dashed: resolve(spec.dashed, ref, index, ref.status === 'showing-fallback'),
        depth: 0,
      });
    });
  }
  const all = [...boxes, ...Array.from(sets.entries()).filter(([key]) => key !== id).flatMap(([, list]) => list)];
  for (const box of boxes) box.depth = all.filter((other) => other.ref !== box.ref && safeAncestor(deps, other.ref, box.ref)).length;
  sets.set(id, boxes);
  activeDeps = deps;
  mount(doc);
  render();
  return { ok: true, id, boxes: boxes.length, skipped };
}

export function clearOverlay(id?: string): { ok: true; cleared: number } {
  let cleared = 0;
  if (id === undefined) {
    for (const list of sets.values()) cleared += list.length;
    sets.clear();
  } else {
    cleared = sets.get(String(id))?.length || 0;
    sets.delete(String(id));
  }
  if (sets.size === 0) unmount();
  else render();
  return { ok: true, cleared };
}

export function listOverlay(): Array<{ id: string; boxes: number }> {
  return Array.from(sets.entries(), ([id, list]) => ({ id, boxes: list.length }));
}
