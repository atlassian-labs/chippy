import { describe, expect, it } from 'vitest';
import {
  PROBE_INTENTS,
  normalizeProbeAnnotation,
  updateProbeAnnotation,
} from './probe-intent';

describe('probe intent', () => {
  it('defines the supported intent vocabulary', () => {
    expect(PROBE_INTENTS).toEqual(['explain', 'investigate', 'change']);
  });

  it('normalizes intent and comment into the required DTO shape', () => {
    expect(normalizeProbeAnnotation({ intent: ' Change ', comment: 'Move this card' })).toEqual({
      intent: 'change',
      comment: 'Move this card',
    });
    expect(normalizeProbeAnnotation({ intent: 'delete', comment: 42 })).toEqual({
      intent: null,
      comment: '',
    });
  });

  it('caps comments at the browser field limit', () => {
    expect(normalizeProbeAnnotation({ comment: 'x'.repeat(2001) }).comment).toHaveLength(2000);
  });

  it('patches one field without dropping the other and supports clearing intent', () => {
    const current = { intent: 'investigate' as const, comment: 'Why is this slow?' };
    expect(updateProbeAnnotation(current, { comment: 'Why does this rerender?' })).toEqual({
      intent: 'investigate',
      comment: 'Why does this rerender?',
    });
    expect(updateProbeAnnotation(current, { intent: null })).toEqual({
      intent: null,
      comment: 'Why is this slow?',
    });
  });
});
