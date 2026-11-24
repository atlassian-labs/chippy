/**
 * Register Chippy packs: JSON documents that add component rules, Avalanche
 * scripts, and agent instructions without a rebuild (see ./spec).
 *
 * A pack becomes a plugin with the same id and is enabled at once, because a
 * pack is only ever present when someone deliberately injected it. A pack
 * whose id matches a registered plugin replaces that plugin.
 */

import { enablePlugins, registerPlugin } from '../index';
import { compileComponents } from './components';
import { compileScripts } from './scripts';
import { type ChippyPack, parsePack } from './spec';

export type { ChippyPack, PackComponentRule, PackLabelRule, PackScripts, PackValueRef } from './spec';
export { parsePack } from './spec';

export type PackStatus = {
  id: string;
  label: string;
  /** How an agent reads this pack's data. */
  instructions: string | null;
  /** Boundary kinds the pack's component rules add. */
  kinds: string[];
  /** Named Avalanche extensions: report key and the script phases each runs. */
  extensions: Array<{
    name: string;
    reportKey: string;
    scripts: Array<'onInit' | 'onStart' | 'onStep' | 'onEnd'>;
    /** Present only when the extension has its own; otherwise the pack's apply. */
    instructions?: string;
  }>;
  /** Scripts the page refused to compile, for example under a strict CSP. */
  compileErrors: string[];
  /**
   * What an extension's `onInit` threw, as `<report key>: <error>`, plus what the
   * replaced version's cleanup threw, as `<report key> cleanup: <error>`.
   */
  initErrors: string[];
};

export type PackLoadResult = { ok: true; pack: PackStatus } | { ok: false; error: string };

/** `unregister` runs the pack's onInit cleanups and returns what they threw. */
const packs = new Map<string, { status: PackStatus; unregister: () => string[] }>();

/** Validate, compile, register, and enable one pack. Throws on an invalid pack. */
export function registerPack(input: unknown): PackStatus {
  const pack: ChippyPack = parsePack(input);
  const contextProvider = compileComponents(pack) ?? undefined;
  const { extensions, hooks, compileErrors } = compileScripts(pack);
  // A replaced pack cleans up first, so the new onInit sees a page without it.
  const initErrors: string[] = packs.get(pack.id)?.unregister() ?? [];
  // Init first: it creates the host globals the page and the other phases read.
  const cleanups: Array<{ id: string; cleanup: () => unknown }> = [];
  for (const { id, init } of extensions) {
    if (!init) continue;
    try {
      const cleanup = init({ id });
      if (typeof cleanup === 'function') cleanups.push({ id, cleanup: cleanup as () => unknown });
    } catch (error) {
      initErrors.push(`${id}: ${messageOf(error)}`);
    }
  }
  const unregister = registerPlugin({
    id: pack.id,
    label: pack.label ?? pack.id,
    ...(contextProvider && { contextProvider }),
    ...(hooks.length && { avalancheHooks: hooks }),
  });
  enablePlugins([pack.id]);
  const status: PackStatus = {
    id: pack.id,
    label: pack.label ?? pack.id,
    instructions: pack.instructions ?? null,
    kinds: (contextProvider?.kinds ?? []).map((kind) => kind.kind),
    extensions: extensions.map(({ id, name }) => ({
      name,
      reportKey: id,
      scripts: (['onInit', 'onStart', 'onStep', 'onEnd'] as const).filter((phase) => !!pack.avalancheExtensions?.[name][phase]),
      ...(pack.avalancheExtensions?.[name].instructions && { instructions: pack.avalancheExtensions[name].instructions }),
    })),
    compileErrors,
    initErrors,
  };
  packs.set(pack.id, {
    status,
    unregister: () => {
      unregister();
      packs.delete(pack.id);
      // Undo onInit's page side effects (observers, wrapped functions, globals), newest first.
      const errors: string[] = [];
      for (const { id, cleanup } of cleanups.reverse()) {
        try {
          cleanup();
        } catch (error) {
          errors.push(`${id} cleanup: ${messageOf(error)}`);
        }
      }
      return errors;
    },
  });
  return status;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Register many packs; one bad pack does not stop the others. */
export function registerPacks(inputs: unknown): PackLoadResult[] {
  const list = Array.isArray(inputs) ? inputs : inputs == null ? [] : [inputs];
  return list.map((input) => {
    try {
      return { ok: true as const, pack: registerPack(input) };
    } catch (error) {
      return { ok: false as const, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/** Remove a pack by id. Returns false when no pack has that id. */
export function unregisterPack(id: string): boolean {
  const entry = packs.get(id);
  if (!entry) return false;
  entry.unregister();
  return true;
}

export function listPacks(): PackStatus[] {
  return [...packs.values()].map((entry) => ({ ...entry.status }));
}

/** Forget every pack. Test helper. */
export function resetPacks(): void {
  for (const id of [...packs.keys()]) unregisterPack(id);
}
