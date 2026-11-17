import { describe, expect, it } from 'vitest';
import { scriptResultJson } from './script-result';

describe('scriptResultJson', () => {
  it('keeps snippet report data nested below the old six-level cut', () => {
    const report = {
      entries: {
        'long-animation-frame': {
          items: [{ scripts: [{ invoker: 'MessagePort.onmessage', source: { url: 'a.js', line: 3 } }], commits: { during: [53], before: [{ id: 52 }] } }],
        },
      },
    };
    expect(scriptResultJson(report)).toEqual(report);
  });

  it('marks cycles but serializes shared references in each place', () => {
    const shared = { n: 1 };
    const loop: Record<string, unknown> = { a: shared, b: shared };
    loop.self = loop;
    expect(scriptResultJson(loop)).toEqual({ a: { n: 1 }, b: { n: 1 }, self: '[Circular]' });
  });

  it('stops at the node budget and flags the result', () => {
    const wide = { list: Array.from({ length: 100 }, (_, i) => ({ i })) };
    const out = scriptResultJson(wide, { maxNodes: 10 }) as { list: unknown[]; _truncated?: boolean };
    expect(out._truncated).toBe(true);
    expect(out.list).toContain('[Truncated]');
    expect(JSON.stringify(out)).toBeTruthy();
  });

  it('turns functions, non-finite numbers, and bigint into JSON-safe values', () => {
    expect(scriptResultJson({ f: function named() {}, x: Infinity, b: BigInt(2) })).toEqual({ f: '[Function named]', x: 'Infinity', b: '2' });
  });
});
