/**
 * Compile a pack's named `avalancheExtensions` into Avalanche hook sets.
 *
 * Each extension becomes one hook set with id `<pack id>.<extension name>`, so
 * extensions keep separate state, errors, and results. `onInit` runs once at
 * registration with `{ id }`. The recording phases are function bodies called
 * with `ctx` (AvalancheHookContext): `ctx.state` persists for one recording,
 * `ctx.commit` describes the commit in `onStep`, and the return value becomes
 * report evidence. A script that cannot compile, for example because the
 * page's Content Security Policy forbids `new Function`, reports that error
 * from every phase it would run.
 */

import type { AvalancheHookContext, AvalancheHooks } from '../../avalanche/avalanche-hooks';
import type { ChippyPack } from './spec';

type Phase = (context: AvalancheHookContext) => unknown;
export type PackInit = (context: { id: string }) => unknown;

export type CompiledExtension = { id: string; name: string; hooks: AvalancheHooks; init: PackInit | null };

export type CompiledScripts = {
  extensions: CompiledExtension[];
  /** Hook sets to register: one per extension, or one carrying only the pack's instructions. */
  hooks: AvalancheHooks[];
  compileErrors: string[];
};

function compile(body: string, name: string, errors: string[]): Phase {
  try {
    // eslint-disable-next-line no-new-func
    return new Function('ctx', body) as Phase;
  } catch (error) {
    const message = `${name} did not compile: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
    errors.push(message);
    return () => {
      throw new Error(message);
    };
  }
}

export function compileScripts(pack: ChippyPack): CompiledScripts {
  const compileErrors: string[] = [];
  const extensions = Object.entries(pack.avalancheExtensions ?? {}).map(([name, scripts]): CompiledExtension => {
    const id = `${pack.id}.${name}`;
    const instructions = scripts.instructions ?? pack.instructions;
    const phase = (key: 'onStart' | 'onStep' | 'onEnd') =>
      scripts[key] ? { [key]: compile(scripts[key]!, `${id} ${key}`, compileErrors) } : {};
    return {
      id,
      name,
      init: scripts.onInit ? (compile(scripts.onInit, `${id} onInit`, compileErrors) as PackInit) : null,
      hooks: { id, ...(instructions && { instructions }), ...phase('onStart'), ...phase('onStep'), ...phase('onEnd') },
    };
  });
  // Instructions alone still travel with every report.
  const hooks = extensions.length
    ? extensions.map((extension) => extension.hooks)
    : pack.instructions
      ? [{ id: pack.id, instructions: pack.instructions }]
      : [];
  return { extensions, hooks, compileErrors };
}
