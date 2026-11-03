/**
 * RTL edge-case tests for debug-render hook contracts.
 *
 * Each test targets a specific contract that would break under:
 * - wrong replay return value (non-object ref, non-callable callback, non-string id)
 * - wrong snapshot value from useSyncExternalStore
 * - rules-of-hooks violation (hook count shift between renders)
 *
 * Tests do NOT require a browser or Chippy. They run in jsdom/Vitest.
 */
import React from 'react';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  RefWriteSUT,
  CallbackSUT,
  IdSUT,
  SyncStoreSUT,
  ConditionalHookSUT,
  counterStore,
} from './DebugHookEdgeSUT.jsx';

// ─── SUT 1: writable ref contract ────────────────────────────────────────────
describe('RefWriteSUT — writable ref contract', () => {
  it('renders without throwing when propsRef.current is assigned', () => {
    expect(() => render(<RefWriteSUT value="hello" />)).not.toThrow();
    expect(screen.getByTestId('ref-write-sut')).toHaveTextContent('hello');
  });

  it('survives a re-render with a new value at the same ref slot', () => {
    const { rerender } = render(<RefWriteSUT value="a" />);
    expect(() => rerender(<RefWriteSUT value="b" />)).not.toThrow();
    expect(screen.getByTestId('ref-write-sut')).toHaveTextContent('b');
  });
});

// ─── SUT 2: callable callback contract ───────────────────────────────────────
describe('CallbackSUT — callable callback contract', () => {
  it('renders and the button is clickable without throwing', () => {
    let clicked = false;
    render(<CallbackSUT onTick={() => { clicked = true; }} />);
    expect(() => fireEvent.click(screen.getByTestId('callback-sut'))).not.toThrow();
    expect(clicked).toBe(true);
  });

  it('survives re-render with a new onTick reference', () => {
    const { rerender } = render(<CallbackSUT onTick={() => {}} />);
    expect(() => rerender(<CallbackSUT onTick={() => {}} />)).not.toThrow();
  });
});

// ─── SUT 3: useId string contract ────────────────────────────────────────────
describe('IdSUT — useId string contract', () => {
  it('renders with a non-empty string id', () => {
    render(<IdSUT />);
    const label = screen.getByTestId('id-sut-label');
    const input = screen.getByTestId('id-sut-input');
    const id = label.getAttribute('for');
    expect(typeof id).toBe('string');
    expect(id!.length).toBeGreaterThan(0);
    expect(input.id).toBe(id);
  });
});

// ─── SUT 4: external store snapshot contract ─────────────────────────────────
describe('SyncStoreSUT — useSyncExternalStore snapshot contract', () => {
  beforeEach(() => {
    // Reset store to 0 by re-creating module state is not possible, but we
    // can just check that returned snapshot is a number, not queue/undefined.
  });

  it('renders a numeric snapshot value, not undefined or object', () => {
    render(<SyncStoreSUT />);
    const output = screen.getByTestId('sync-store-sut');
    const text = output.textContent ?? '';
    expect(() => parseInt(text, 10)).not.toThrow();
    expect(Number.isFinite(parseInt(text, 10))).toBe(true);
  });

  it('updates the DOM when the store emits', async () => {
    render(<SyncStoreSUT />);
    const before = parseInt(screen.getByTestId('sync-store-sut').textContent ?? '', 10);
    await act(async () => { counterStore.increment(); });
    const after = parseInt(screen.getByTestId('sync-store-sut').textContent ?? '', 10);
    expect(after).toBe(before + 1);
  });
});

// ─── SUT 5: conditional hook violation ───────────────────────────────────────
describe('ConditionalHookSUT — rules-of-hooks violation', () => {
  it('renders correctly when condition is false (baseline: one useState)', () => {
    expect(() => render(<ConditionalHookSUT condition={false} />)).not.toThrow();
    expect(screen.getByTestId('conditional-hook-sut')).toHaveTextContent('0');
  });

  it('throws or fails when condition flips and hook count shifts mid-render', () => {
    const { rerender } = render(<ConditionalHookSUT condition={false} />);
    // React should throw when the number of hooks changes between renders.
    // This is the rule-of-hooks violation. We assert it throws rather than
    // silently succeeding with a misaligned hook slot. React and jsdom also
    // report the error to console.error; keep it out of the test output.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      expect(() => rerender(<ConditionalHookSUT condition={true} />)).toThrow();
    } finally {
      consoleError.mockRestore();
    }
  });
});
