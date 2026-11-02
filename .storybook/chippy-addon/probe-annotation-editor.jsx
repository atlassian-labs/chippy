import React, { useEffect, useState } from 'react';
import { PROBE_INTENTS, normalizeProbeAnnotation } from '../../src/layout-lab/probe-intent.ts';

const INTENT_LABELS = {
  explain: 'Explain',
  investigate: 'Investigate',
  change: 'Change',
};

export function ProbeAnnotationEditor({ markerId, intent, comment, onAttach }) {
  const [draft, setDraft] = useState(() => normalizeProbeAnnotation({ intent, comment }));

  useEffect(() => {
    setDraft(normalizeProbeAnnotation({ intent, comment }));
  }, [intent, comment]);

  const changeIntent = (event) => {
    const next = normalizeProbeAnnotation({ ...draft, intent: event.target.value || null });
    setDraft(next);
    onAttach?.(next);
  };

  const commitComment = (event) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent?.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    onAttach?.(normalizeProbeAnnotation({ ...draft, comment: event.currentTarget.value }));
  };

  return (
    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
      <select
        aria-label={`P${markerId} intent`}
        value={draft.intent || ''}
        onChange={changeIntent}
        style={{ width: '100%', padding: '5px 7px', borderRadius: 6 }}
      >
        <option value="">Choose intent</option>
        {PROBE_INTENTS.map((value) => <option key={value} value={value}>{INTENT_LABELS[value]}</option>)}
      </select>
      <textarea
        aria-label={`P${markerId} comment`}
        maxLength={2000}
        placeholder="What should Chippy do with this probe?"
        value={draft.comment}
        onChange={(event) => setDraft((current) => ({ ...current, comment: event.target.value }))}
        onKeyDown={commitComment}
        style={{ boxSizing: 'border-box', width: '100%', minHeight: 58, resize: 'vertical', padding: '6px 7px', borderRadius: 6 }}
      />
    </div>
  );
}
