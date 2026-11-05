// The shipped IIFE bundle assigns its export to `__AVALANCHE__`. An armed
// extension reload evaluates it twice on one document: once from the one-shot
// document_start registration, which installs Avalanche, and once from the
// background's navigation injection. The second evaluation must keep the
// installed runtime published.
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const BUNDLE = readFileSync(resolve(__dirname, '../../.agents/skills/chippy/extension/avalanche.iife.js'), 'utf8');
const runtime = globalThis as any;

function evaluateBundle() {
  // Indirect eval runs the classic script at global scope, as a page would.
  (0, eval)(BUNDLE);
  return runtime.__AVALANCHE__;
}

afterEach(() => {
  try { runtime.__AVALANCHE__?.uninstall?.(); } catch {}
  delete runtime.__AVALANCHE__;
  delete runtime.__CHIPPY_STARTUP_CONFIG;
});

describe('avalanche.iife.js evaluated twice', () => {
  it('keeps the runtime that the first evaluation installed', () => {
    runtime.__CHIPPY_STARTUP_CONFIG = { enabled: true, avalanche: { autoStart: true, options: { detectionMode: 'sources' } } };
    const first = evaluateBundle();
    expect(first.status().installed).toBe(true);

    const second = evaluateBundle();
    expect(second).toBe(first);
    expect(second.status().installed).toBe(true);
  });

  it('keeps the published runtime when the first evaluation did not install', () => {
    const first = evaluateBundle();
    expect(first.status().installed).toBe(false);
    expect(evaluateBundle()).toBe(first);
  });
});
