/**
 * The run ledger: every script-kit building block that cannot give a complete,
 * fully confident answer records why here, and the runner returns the ledger
 * next to the script's result. A walk that stops early deep inside a script is
 * therefore still visible at the top of the output.
 */

export type LimitKind = 'truncated' | 'confidence' | 'raw' | 'gap';

export interface LimitEntry {
  primitive: string;
  kind: LimitKind;
  detail: string;
  /** How many times the same limit was hit during the run. */
  count: number;
}

export interface Ledger {
  add(primitive: string, kind: LimitKind, detail: string): void;
  entries(): LimitEntry[];
}

export function createLedger(): Ledger {
  const byKey = new Map<string, LimitEntry>();
  return {
    add(primitive, kind, detail) {
      const key = primitive + '\u0000' + kind + '\u0000' + detail;
      const existing = byKey.get(key);
      if (existing) existing.count += 1;
      else byKey.set(key, { primitive, kind, detail, count: 1 });
    },
    entries() {
      return Array.from(byKey.values(), (entry) => ({ ...entry }));
    },
  };
}

/** Thrown when a script calls a building block that needs an `--allow` gate. */
export class GateError extends Error {
  readonly gate: string;
  constructor(gate: string, reason: string) {
    super(`${reason} Rerun eval-page with --allow ${gate} after stating the target and what the stimulus pollutes.`);
    this.name = 'GateError';
    this.gate = gate;
  }
}

export const SCRIPT_GATES = ['replay'] as const;
export type ScriptGate = (typeof SCRIPT_GATES)[number];

export interface ParsedGates {
  allowed: ScriptGate[];
  /** Requested gates this runtime does not know; reported so a typo is not silently ignored. */
  unknown: string[];
}

export function parseGates(value: unknown): ParsedGates {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  const allowed: ScriptGate[] = [];
  const unknown: string[] = [];
  for (const item of raw) {
    const gate = String(item).trim();
    if (!gate) continue;
    if ((SCRIPT_GATES as readonly string[]).includes(gate)) {
      if (!allowed.includes(gate as ScriptGate)) allowed.push(gate as ScriptGate);
    } else if (!unknown.includes(gate)) {
      unknown.push(gate);
    }
  }
  return { allowed, unknown };
}
