import React, { useEffect, useState } from 'react';
import { PROBE_INTENTS, normalizeProbeAnnotation } from '../../src/layout-lab/probe-intent.ts';

const SEND_ON_SELECT_INTENTS = new Set(['explain', 'investigate']);

const STATUS_TEXT = {
  idle: 'Explain and Investigate send when chosen. For Change, describe it and press Enter.',
  draft: 'Not sent. Press Enter in the comment to send.',
  queued: 'Queued for the agent.',
  done: 'Done. The agent handled the last note.',
};

const INTENT_LABELS = {
  explain: 'Explain',
  investigate: 'Investigate',
  change: 'Change',
};

export function ProbeAnnotationEditor({ markerId, intent, comment, status = null, onAttach }) {
  const [draft, setDraft] = useState(() => normalizeProbeAnnotation({ intent, comment }));

  useEffect(() => {
    setDraft(normalizeProbeAnnotation({ intent, comment }));
  }, [intent, comment]);

  // Explain and Investigate need no description, so choosing them sends.
  // Change needs one: it stays a draft until Enter in the comment.
  const changeIntent = (event) => {
    const next = normalizeProbeAnnotation({ ...draft, intent: event.target.value || null });
    setDraft(next);
    if (SEND_ON_SELECT_INTENTS.has(next.intent)) onAttach?.(next);
  };
  const sent = normalizeProbeAnnotation({ intent, comment });
  const unsent = draft.intent !== sent.intent || draft.comment !== sent.comment;

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
      <span data-chippy-probe-annotation-status={markerId} style={{ fontSize: 11, opacity: 0.75 }}>
        {unsent ? STATUS_TEXT.draft : (STATUS_TEXT[status] || STATUS_TEXT.idle)}
      </span>
    </div>
  );
}
