export const PROBE_INTENTS = ['explain', 'investigate', 'change'] as const;

export type ProbeIntent = (typeof PROBE_INTENTS)[number];

export type ProbeAnnotation = {
  intent: ProbeIntent | null;
  comment: string;
};

const MAX_COMMENT_LENGTH = 2000;
const INTENT_SET = new Set<string>(PROBE_INTENTS);

export function normalizeProbeAnnotation(value: unknown): ProbeAnnotation {
  const input = value && typeof value === 'object'
    ? value as { intent?: unknown; comment?: unknown }
    : {};
  const rawIntent = typeof input.intent === 'string' ? input.intent.trim().toLowerCase() : '';

  return {
    intent: INTENT_SET.has(rawIntent) ? rawIntent as ProbeIntent : null,
    comment: typeof input.comment === 'string'
      ? input.comment.slice(0, MAX_COMMENT_LENGTH)
      : '',
  };
}

export function updateProbeAnnotation(
  current: ProbeAnnotation,
  patch: Partial<ProbeAnnotation>,
): ProbeAnnotation {
  return normalizeProbeAnnotation({
    intent: patch.intent === undefined ? current.intent : patch.intent,
    comment: patch.comment === undefined ? current.comment : patch.comment,
  });
}
