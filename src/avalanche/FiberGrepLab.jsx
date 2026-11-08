import { Component, useDebugValue, useMemo, useReducer, useRef, useState } from 'react';

// Fixture for `find-fibers --grep`: the same issue key appears in a prop, in
// hook state, in a ref, in a memo, in class state, and in a useDebugValue label.

function useIssueStore(issueKey) {
  const [issue] = useState(() => ({ key: issueKey, summary: 'Grep lab issue' }));
  useDebugValue(issue, (value) => 'IssueStore: ' + value.key);
  return issue;
}

function useFormattedTitle(summary) {
  const title = useMemo(() => ({ display: summary.toUpperCase() }), [summary]);
  useDebugValue('title-hook');
  return title;
}

function IssueRow({ issue, onIssueSelect }) {
  const store = useIssueStore(issue.key);
  const title = useFormattedTitle(store.summary);
  const lastSeen = useRef('GREP-LAB-REF');
  return (
    <button type="button" data-testid="grep-lab-row" onClick={() => onIssueSelect(store.key)}>
      {title.display} · {lastSeen.current}
    </button>
  );
}

class LegacyPanel extends Component {
  state = { mode: 'GREP-LAB-CLASS-STATE' };
  render() {
    return <div data-testid="grep-lab-legacy">{this.state.mode}</div>;
  }
}

export default function FiberGrepLab() {
  const [selected, select] = useReducer((_, key) => key, 'none');
  function onIssueSelect(key) { select(key); }
  return (
    <div data-testid="grep-lab">
      <IssueRow issue={{ key: 'GREP-LAB-42', labels: ['alpha'] }} onIssueSelect={onIssueSelect} />
      <LegacyPanel />
      <output data-testid="grep-lab-selected">{selected}</output>
    </div>
  );
}
