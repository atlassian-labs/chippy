import React from 'react';

export const CHIPPY_INSTALL_COMMAND = 'npx @atlassian/chippy install';

const unavailableConnectionStates = new Set(['failed', 'reconnecting']);

export function shouldShowChippyInstallHint(connState) {
  return unavailableConnectionStates.has(connState);
}

export function ChippyConnectionFallback({ connState }) {
  if (!shouldShowChippyInstallHint(connState)) return null;

  return (
    <div
      role="status"
      data-testid="chippy-install-hint"
      style={{
        marginBottom: 8,
        padding: '10px 12px',
        border: '1px solid var(--color-warning-border, #b88a00)',
        borderRadius: 8,
        background: 'var(--color-warning-background, color-mix(in srgb, #b88a00 12%, Canvas))',
        color: 'var(--color-default-text, CanvasText)',
        fontSize: 12,
        lineHeight: 1.45,
      }}
    >
      <div style={{ marginBottom: 6 }}>
        Chippy’s local helper isn’t reachable. If Chippy isn’t installed for your agent, run:
      </div>
      <code
        style={{
          display: 'block',
          padding: '7px 8px',
          borderRadius: 6,
          background: 'var(--color-elevated-surface, color-mix(in srgb, Canvas 88%, CanvasText 12%))',
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          overflowWrap: 'anywhere',
          userSelect: 'all',
        }}
      >
        {CHIPPY_INSTALL_COMMAND}
      </code>
    </div>
  );
}
