import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ChippyConnectionFallback,
  shouldShowChippyInstallHint,
} from '../../.storybook/chippy-addon/connection-fallback.jsx';

afterEach(cleanup);

describe('Chippy Storybook connection fallback', () => {
  it.each(['failed', 'reconnecting'])('shows the global install command while the helper is %s', (connState) => {
    render(<ChippyConnectionFallback connState={connState} />);

    expect(screen.getByRole('status')).toHaveTextContent('Chippy’s local helper isn’t reachable.');
    expect(screen.getByTestId('chippy-install-hint')).toHaveTextContent(
      'npx skills add atlassian-labs/chippy --skill chippy -g',
    );
    expect(screen.getByTestId('chippy-install-hint')).toHaveTextContent(
      'If Chippy isn’t installed for your agent, run:',
    );
  });

  it.each([undefined, 'unknown', 'connecting', 'connected'])('stays hidden for %s', (connState) => {
    render(<ChippyConnectionFallback connState={connState} />);

    expect(screen.queryByTestId('chippy-install-hint')).not.toBeInTheDocument();
    expect(shouldShowChippyInstallHint(connState)).toBe(false);
  });
});
