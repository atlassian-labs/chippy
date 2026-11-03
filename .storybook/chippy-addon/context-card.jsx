import React from 'react';

const colors = {
  text: 'var(--color-default-text, CanvasText)',
  muted: 'var(--color-subtle-text, color-mix(in srgb, CanvasText 64%, transparent))',
  border: 'var(--color-medium-border, color-mix(in srgb, CanvasText 18%, transparent))',
  provider: 'var(--color-accent, #5e6c84)',
  error: 'var(--color-negative-text, #ae2e24)',
  suspense: 'var(--color-purple-text, #7c3aed)',
};

function DetailFields({ fields }) {
  const visible = fields.filter(([, value]) => value != null && value !== '');
  if (!visible.length) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '3px 10px', marginTop: 5, color: colors.muted, fontSize: 11 }}>
      {visible.map(([label, value]) => (
        <span key={label}>
          <span style={{ textTransform: 'lowercase' }}>{label}</span>{' '}
          <strong style={{ color: colors.text }}>{String(value)}</strong>
        </span>
      ))}
    </div>
  );
}

function DistanceBadge({ distance }) {
  if (distance == null) return null;
  const hops = distance === 1 ? '1 hop' : `${distance} hops`;
  return (
    <span
      data-testid="chippy-boundary-distance"
      style={{
        marginLeft: 'auto',
        padding: '1px 6px',
        borderRadius: 999,
        background: 'color-mix(in srgb, CanvasText 12%, transparent)',
        color: colors.muted,
        fontSize: 10,
        fontWeight: 600,
        flexShrink: 0,
      }}
    >
      {hops}
    </span>
  );
}

// A single declarative boundary block. Clickable: reports the boundary + its
// fiber-hop distance to the Chippy backend so it can be investigated later.
// This is NOT the React render owner -- it is a collateral-scope boundary.
function BoundaryBlock({ testId, kind, label, title, accent, distance, fields, onInspect, selected, onSelect }) {
  const clickable = typeof onInspect === 'function';
  const activate = clickable
    ? () => {
        if (onSelect) onSelect(kind);
        onInspect(kind);
      }
    : undefined;
  return (
    <div
      data-testid={testId}
      data-chippy-boundary={kind}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={activate}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
              }
            }
          : undefined
      }
      style={{
        borderLeft: `3px solid ${accent}`,
        padding: '6px 8px',
        background: 'color-mix(in srgb, Canvas 94%, CanvasText 6%)',
        cursor: clickable ? 'pointer' : 'default',
        outline: selected ? '2px solid var(--color-default-text, CanvasText)' : 'none',
        outlineOffset: selected ? 1 : 0,
      }}
      data-chippy-boundary-selected={selected ? 'true' : undefined}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
        <span style={{ color: accent, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', flexShrink: 0 }}>{label}</span>
        <strong style={{ color: colors.text, fontSize: 12, overflowWrap: 'anywhere' }}>{title}</strong>
        <DistanceBadge distance={distance} />
      </div>
      <DetailFields fields={fields} />
    </div>
  );
}

const EMPTY_DISPLAY = { kinds: [], titles: {}, fields: {}, showError: false };

function contextDisplay(context) {
  return context.display || EMPTY_DISPLAY;
}

function toFieldPairs(fields) {
  return (fields || []).map((field) => [field.label, field.value]);
}

/**
 * Renders the marker context: provider boundary kinds first (for example a
 * team ownership marker), then the fiber-native error and suspense boundaries.
 * Without onInspectBoundary the boundary blocks render as static facts.
 * @param {{ context: any, onInspectBoundary?: (kind: string) => void }} props
 */
export function ContextCard({ context, onInspectBoundary }) {
  const [selectedKind, setSelectedKind] = React.useState(null);
  if (!context) return null;
  const display = contextDisplay(context);
  const boundaries = context.boundaries || {};
  const providerKinds = (display.kinds || []).filter((kind) => boundaries[kind.kind]);
  const error = boundaries.error || null;
  const suspense = boundaries.suspense || null;
  const showError = !!(error || display.showError);
  if (!providerKinds.length && !showError && !suspense) return null;

  const blockProps = (kind) => ({
    onInspect: onInspectBoundary,
    selected: selectedKind === kind,
    onSelect: setSelectedKind,
  });

  return (
    <div data-testid="chippy-context" style={{ display: 'grid', gap: 5, marginTop: 8, borderTop: `1px solid ${colors.border}`, paddingTop: 8 }}>
      {providerKinds.map((kind) => (
        <BoundaryBlock
          key={kind.kind}
          testId={`chippy-boundary-${kind.kind}`}
          kind={kind.kind}
          label={kind.label}
          title={display.titles?.[kind.kind] || boundaries[kind.kind]?.componentName || kind.label}
          accent={kind.accent || colors.provider}
          distance={boundaries[kind.kind]?.distance}
          fields={toFieldPairs(display.fields?.[kind.kind])}
          {...blockProps(kind.kind)}
        />
      ))}
      {showError ? (
        <BoundaryBlock
          testId="chippy-boundary-error"
          kind="error"
          label="error boundary"
          title={display.titles?.error || error?.componentName || 'ErrorBoundary'}
          accent={colors.error}
          distance={error?.distance}
          fields={toFieldPairs(display.fields?.error)}
          {...blockProps('error')}
        />
      ) : null}
      {suspense ? (
        <BoundaryBlock
          testId="chippy-boundary-suspense"
          kind="suspense"
          label="suspense boundary"
          title={suspense.componentName || 'Suspense'}
          accent={colors.suspense}
          distance={suspense.distance}
          fields={[]}
          {...blockProps('suspense')}
        />
      ) : null}
    </div>
  );
}
