import { ChippyLogo } from './brand.jsx';
import React, { useEffect, useState } from 'react';
import { addons, types } from 'storybook/manager-api';
import { AddonPanel, Badge, Button, ScrollArea } from 'storybook/internal/components';
import { ADDON_ID, AVALANCHE_PANEL_ID, CHIPPY_PANEL_ID, EVENTS, PREVIEW_MESSAGE_SOURCE } from './constants.js';
import { ChippyConnectionFallback } from './connection-fallback.jsx';
import { commitSpan, describeCommitAction, groupCommitRows } from './avalanche-panel-model.js';
import { ContextCard } from './context-card.jsx';
import { claimManagerOwner, extensionBridgeInManager } from './manager-owner.js';
import { ProbeAnnotationEditor } from './probe-annotation-editor.jsx';

const panelFont = "'Atlassian Sans', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
const theme = {
  text: 'var(--ds-text, var(--color-default-text, CanvasText))',
  muted: 'var(--color-subtle-text, color-mix(in srgb, CanvasText 64%, transparent))',
  border: 'var(--color-medium-border, color-mix(in srgb, CanvasText 18%, transparent))',
  panel: 'var(--ds-surface, var(--color-surface, Canvas))',
  raised: 'var(--color-elevated-surface, color-mix(in srgb, Canvas 94%, CanvasText 6%))',
  row: 'var(--color-hover-background, color-mix(in srgb, Canvas 88%, CanvasText 12%))',
  danger: 'var(--color-negative-text, #ffb4ab)',
};

claimManagerOwner();

function postToPreview(message) {
  const iframe = document.getElementById('storybook-preview-iframe');
  iframe?.contentWindow?.postMessage({ source: PREVIEW_MESSAGE_SOURCE, ...message }, '*');
}

function isModeSelected(mode) {
  const label = mode === 'avalanche' ? 'Avalanche' : 'Chippy';
  const tab = Array.from(document.querySelectorAll('[role="tab"]'))
    .find((candidate) => candidate.textContent?.trim() === label);
  return tab?.getAttribute('aria-selected') === 'true';
}

function syncMode(channel, mode, active) {
  if (!active || !isModeSelected(mode)) return;
  channel.emit(EVENTS.SET_MODE, mode);
  postToPreview({ event: EVENTS.SET_MODE, payload: mode });
}

function useChippyChannel(mode, active) {
  const channel = addons.getChannel();
  const [payload, setPayload] = useState(null);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    const onState = (next) => setPayload(next);
    const onResult = (next) => setLastResult(next);
    channel.on(EVENTS.STATE, onState);
    channel.on(EVENTS.RESULT, onResult);
    channel.emit(EVENTS.REQUEST_STATE);
    syncMode(channel, mode, active);
    const timer = setInterval(() => {
      channel.emit(EVENTS.REQUEST_STATE);
      syncMode(channel, mode, active);
    }, 3000);
    return () => {
      clearInterval(timer);
      channel.off(EVENTS.STATE, onState);
      channel.off(EVENTS.RESULT, onResult);
    };
  }, [channel, active, mode]);

  return {
    payload,
    lastResult,
    command: (type, extra = {}) => {
      const command = { type, ...extra };
      if (!active || !isModeSelected(mode)) return;
      channel.emit(EVENTS.COMMAND, command);
      postToPreview({ event: EVENTS.COMMAND, payload: command });
    },
    refresh: () => channel.emit(EVENTS.REQUEST_STATE),
  };
}

function statusFrom(payload) {
  if (payload?.blocked) return { label: 'blocked', status: 'negative' };
  const state = payload?.state;
  if (!state) return { label: 'waiting', status: 'warning' };
  return { label: state.connState || 'ready', status: state.connState === 'connected' ? 'positive' : 'warning' };
}

function RuntimeLine({ payload }) {
  const state = payload?.state;
  const owner = payload?.owner || state?.owner;
  const integration = state?.integration || owner?.integration;
  const status = statusFrom(payload);
  const story = state?.page?.storyId || 'no story';
  const client = state?.clientId ? String(state.clientId).slice(0, 8) : 'no client';
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', color: theme.muted, fontSize: 11 }}>
      <Badge status={status.status}>{status.label}</Badge>
      <span>{integration?.who || 'Unidentified Chippy integration'}</span>
      <span>({integration?.kind || 'unknown'})</span>
      <span>·</span>
      <span>{story}</span>
      <span>·</span>
      <span>{client}</span>
    </div>
  );
}

function Header({ title, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
      <h2 style={{ margin: 0, fontSize: 14, lineHeight: 1, color: theme.text, display: 'flex', alignItems: 'center', gap: 8 }}><ChippyLogo />{title}</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{children}</div>
    </div>
  );
}

function Footer({ payload }) {
  return (
    <details style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 8, marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', color: theme.muted, fontSize: 11 }}>Connection details</summary>
      <div style={{ marginTop: 8 }}><RuntimeLine payload={payload} /></div>
    </details>
  );
}

function Section({ title, children }) {
  return (
    <section style={{ borderTop: `1px solid ${theme.border}`, padding: '10px 0', color: theme.text }}>
      {title ? <h3 style={{ margin: '0 0 8px', fontSize: 13, color: theme.text }}>{title}</h3> : null}
      {children}
    </section>
  );
}

function Empty({ children }) {
  return <div style={{ color: theme.muted, fontSize: 12, padding: '8px 0' }}>{children}</div>;
}

function SmallJson({ value }) {
  if (value == null) return null;
  return (
    <details style={{ marginTop: 8, color: theme.text }}>
      <summary style={{ cursor: 'pointer', color: theme.muted, fontSize: 12 }}>raw</summary>
      <pre style={{ margin: '8px 0 0', whiteSpace: 'pre-wrap', fontSize: 11, lineHeight: 1.4, maxHeight: 240, overflow: 'auto', color: theme.text, background: theme.raised, border: `1px solid ${theme.border}`, borderRadius: 6, padding: 8 }}>
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function compactSource(source) {
  if (!source?.fileName) return '—';
  const file = String(source.fileName).split('/').slice(-2).join('/');
  return `${file}${source.lineNumber ? `:${source.lineNumber}` : ''}`;
}

function MarkerSummary({ markers, onInspectBoundary, onAttachAnnotation }) {
  const entries = Object.entries(markers || {});
  if (!entries.length) return <Empty>Open the Chippy panel to activate probes. Drag P1/P2 from the dock onto the story.</Empty>;
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      {entries.map(([id, marker]) => {
        const resolved = marker?.resolved || {};
        const component = resolved.component || {};
        const dom = resolved.dom || {};
        const owners = component.owners || [];
        const source = component.source || dom.source;
        const markerContext = marker?.context ?? null;
        return (
          <div key={id} style={{ border: `1px solid ${theme.border}`, borderRadius: 8, padding: 8, background: theme.raised, color: theme.text }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <strong>P{id}</strong>
              <Badge status={resolved.confidence === 'dev' || resolved.confidence === 'high' ? 'positive' : 'neutral'}>{marker?.docked ? 'docked' : 'active'}</Badge>
            </div>
            <div style={{ color: theme.text, fontSize: 13, marginTop: 6, fontWeight: 600 }}>
              {component.name || dom.tag || 'Drag marker onto the story'}
            </div>
            <div style={{ color: theme.muted, fontSize: 12, marginTop: 3 }}>
              {resolved.nearestTestId ? `testId ${resolved.nearestTestId} · ` : ''}{dom.tag ? `<${dom.tag}>` : 'no DOM target'}
            </div>
            <div style={{ color: theme.muted, fontSize: 12, marginTop: 3 }}>source {compactSource(source)}</div>
            {owners.length ? <div style={{ color: theme.muted, fontSize: 12, marginTop: 3 }}>owner {owners[0]?.name || '—'} · chain {owners.length}</div> : null}
            <ContextCard
              context={markerContext}
              onInspectBoundary={
                onInspectBoundary
                  ? (kind) => onInspectBoundary(id, kind, markerContext?.boundaries?.[kind] || null)
                  : undefined
              }
            />
            {!marker?.docked ? (
              <ProbeAnnotationEditor
                markerId={id}
                intent={marker?.intent}
                comment={marker?.comment}
                onAttach={(annotation) => onAttachAnnotation?.(id, annotation)}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function resultEnvelope(lastResult) {
  const result = lastResult?.result || null;
  const payload = result?.payload || null;
  return { result, payload };
}

function rowsFromAvalanchePayload(payload) {
  const auto = payload?.avalancheAuto || {};
  return {
    hotItems: auto.hotSources?.payload?.items || auto.hotSources?.items || [],
    commitRows: auto.commitList?.rows || auto.commitList?.payload?.rows || [],
  };
}

function rowsFromAvalancheResult(lastResult) {
  const { result, payload } = resultEnvelope(lastResult);
  if (!result) return { result: null, hotItems: [], commitRows: [], peek: null };
  return {
    result,
    hotItems: result.action === 'hot-sources' ? payload?.items || [] : [],
    commitRows: result.action === 'commit-list' ? result.rows || [] : [],
    peek: result.action === 'commit-peek' ? payload || null : null,
  };
}

function SimpleTable({ columns, rows, empty, onRowClick }) {
  if (!rows?.length) return <Empty>{empty}</Empty>;
  return (
    <div style={{ border: `1px solid ${theme.border}`, borderRadius: 8, overflow: 'hidden', background: theme.panel, color: theme.text }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, color: theme.text }}>
        <thead style={{ background: theme.raised }}>
          <tr>{columns.map((column) => <th key={column.key} style={{ textAlign: 'left', padding: 8, borderBottom: `1px solid ${theme.border}`, color: theme.text }}>{column.label}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.commitId || row.sourceId || index} onClick={onRowClick ? () => onRowClick(row) : undefined} style={{ cursor: onRowClick ? 'pointer' : 'default' }}>
              {columns.map((column) => <td key={column.key} style={{ padding: 8, borderTop: index ? `1px solid ${theme.border}` : 'none', verticalAlign: 'top', color: theme.text }}>{column.render ? column.render(row) : String(row[column.key] ?? '—')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Shown when an extension bridge is still connected from the manager window, so
// a `pages` entry of kind `extension` would inspect Storybook's own UI.
function ExtensionConflict() {
  const [conflict, setConflict] = useState(() => !!extensionBridgeInManager());
  useEffect(() => {
    const timer = setInterval(() => setConflict(!!extensionBridgeInManager()), 3000);
    return () => clearInterval(timer);
  }, []);
  if (!conflict) return null;
  return (
    <div role="alert" style={{ color: theme.danger, fontSize: 12, marginBottom: 12 }}>
      The Chippy extension is also connected from the Storybook manager. Its `extension` page inspects
      Storybook&apos;s UI; use the `storybook` page for the story, or update the extension.
    </div>
  );
}

function ChippyPanel({ active }) {
  const { payload, command } = useChippyChannel('chippy', active);
  const inspectBoundary = React.useCallback(
    (markerId, boundaryKind, boundary) =>
      command('inspect-boundary', {
        markerId,
        boundaryKind,
        boundary,
        distance: boundary?.distance ?? null,
      }),
    [command],
  );
  const attachAnnotation = React.useCallback(
    (markerId, annotation) => command('set-probe-annotation', { markerId, ...annotation }),
    [command],
  );
  const state = payload?.state;
  const markers = state?.markers || {};
  const probesVisible = Object.values(markers).some((marker) => marker?.position != null);
  return (
    <AddonPanel active={active}>
      <ScrollArea vertical horizontal>
        <div style={{ padding: 16, fontFamily: panelFont, maxWidth: 840, color: theme.text, background: theme.panel, minHeight: '100%' }}>
          <Header title="Chippy">
            <Button
              size="small"
              ariaLabel={false}
              variant={probesVisible ? 'outline' : undefined}
              onClick={() => command(probesVisible ? 'clear-probes' : 'ensure-probes')}
            >
              {probesVisible ? 'Hide probes' : 'Show probes'}
            </Button>
          </Header>
          <ChippyConnectionFallback connState={state?.connState} />
          <ExtensionConflict />
          <Section>
            {probesVisible ? (
              <div style={{ color: theme.muted, fontSize: 12, marginBottom: 8 }}>
                While dragging: ← parent DOM · → toward target · ↑ parent component · ↓ toward target
              </div>
            ) : null}
            {probesVisible
              ? <MarkerSummary markers={markers} onInspectBoundary={inspectBoundary} onAttachAnnotation={attachAnnotation} />
              : <Empty>Show probes when you want to inspect an element in the story.</Empty>}
          </Section>
          <Footer payload={payload} />
        </div>
      </ScrollArea>
    </AddonPanel>
  );
}

function AvalanchePanel({ active }) {
  const { payload, lastResult, command } = useChippyChannel('avalanche', active);
  const autoRows = rowsFromAvalanchePayload(payload);
  const { result, peek } = rowsFromAvalancheResult(lastResult);
  const hotItems = autoRows.hotItems;
  const rows = autoRows.commitRows;
  const patterns = groupCommitRows(rows);

  const status = payload?.avalancheStatus?.status || payload?.state?.avalanche?.status || null;
  const error = result?.ok === false ? result.error : null;

  useEffect(() => {
    if (!active) return;
    if (status?.installed) return;
    const timer = setTimeout(() => command('avalanche-install', { reason: 'panel-active-retry' }), 250);
    return () => clearTimeout(timer);
  }, [active, status?.installed]);

  return (
    <AddonPanel active={active}>
      <ScrollArea vertical horizontal>
        <div style={{ padding: 16, fontFamily: panelFont, maxWidth: 980, color: theme.text, background: theme.panel, minHeight: '100%' }}>
          <Header title="Avalanche" />
          <ChippyConnectionFallback connState={payload?.state?.connState} />
          {error ? <div style={{ color: theme.danger, fontSize: 12, marginBottom: 8 }}>{error}</div> : null}
          <Section title="Commit patterns">
            <SimpleTable
              rows={patterns}
              empty="Waiting for the story to render something new."
              onRowClick={(group) => command('avalanche-commit-peek', { commitId: group.representative.commitId })}
              columns={[
                { key: 'count', label: 'repeats', render: (group) => group.count === 1 ? 'once' : `${group.count}×` },
                { key: 'span', label: 'commits', render: commitSpan },
                { key: 'action', label: 'activity', render: (group) => describeCommitAction(group.representative) },
                { key: 'sources', label: 'sources', render: (group) => group.representative.sourceCount ?? 0 },
                { key: 'collateral', label: 'collateral', render: (group) => group.representative.stat?.collateral ?? 0 },
                { key: 'effects', label: 'effects', render: (group) => group.representative.stat?.effects ?? 0 },
              ]}
            />
          </Section>
          <Section title="Sources with the widest impact">
            <SimpleTable
              rows={hotItems.slice(0, 10)}
              empty="No source has caused measurable downstream work yet."
              columns={[
                { key: 'sourceId', label: 'source' },
                { key: 'collateralUpdates', label: 'collateral' },
                { key: 'causedUpdates', label: 'caused' },
                { key: 'restartWaste', label: 'restart waste' },
              ]}
            />
          </Section>
          {peek ? (
            <Section title={`Commit ${peek.commitId} peek`}>
              <div style={{ display: 'flex', gap: 10, color: theme.muted, fontSize: 12, marginBottom: 8 }}>
                <span>found: <strong style={{ color: theme.text }}>{String(!!peek.found)}</strong></span>
                <span>sources: <strong style={{ color: theme.text }}>{peek.sourcesTotal ?? peek.sources?.length ?? 0}</strong></span>
                <span>actions: <strong style={{ color: theme.text }}>{peek.actionsTotal ?? peek.actions?.length ?? 0}</strong></span>
              </div>
              <SimpleTable
                rows={peek.sources || []}
                empty="No source rows in this peek."
                columns={[
                  { key: 'sourceId', label: 'source' },
                  { key: 'collateralAtCommit', label: 'collateral@commit' },
                  { key: 'causedUpdatesTotal', label: 'caused total' },
                  { key: 'collateralUpdatesTotal', label: 'collateral total' },
                ]}
              />
              <SmallJson value={peek} />
            </Section>
          ) : null}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: theme.muted, fontSize: 12 }}>Individual commits ({rows.length})</summary>
            <div style={{ marginTop: 8 }}>
              <SimpleTable
                rows={rows}
                empty="No commits captured."
                onRowClick={(row) => command('avalanche-commit-peek', { commitId: row.commitId })}
                columns={[
                  { key: 'commitId', label: 'commit' },
                  { key: 'sourceCount', label: 'sources' },
                  { key: 'collateral', label: 'collateral', render: (row) => row.stat?.collateral ?? 0 },
                  { key: 'effects', label: 'effects', render: (row) => row.stat?.effects ?? 0 },
                  { key: 'action', label: 'activity', render: describeCommitAction },
                ]}
              />
            </div>
          </details>
          <Footer payload={payload} />
        </div>
      </ScrollArea>
    </AddonPanel>
  );
}

addons.register(ADDON_ID, () => {
  addons.add(CHIPPY_PANEL_ID, {
    title: 'Chippy',
    type: types.PANEL,
    render: ({ active }) => <ChippyPanel active={active} />,
  });
  addons.add(AVALANCHE_PANEL_ID, {
    title: 'Avalanche',
    type: types.PANEL,
    render: ({ active }) => <AvalanchePanel active={active} />,
  });
});
