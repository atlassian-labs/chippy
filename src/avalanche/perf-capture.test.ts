import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPerfCapture, shapePerfEntry } from './perf-capture';

type Callback = (list: { getEntries(): unknown[] }) => void;

class FakeObserver {
  static supportedEntryTypes: string[] = ['mark', 'measure', 'long-animation-frame', 'layout-shift', 'event', 'paint'];
  static all: FakeObserver[] = [];
  options: Record<string, unknown> | null = null;
  queued: unknown[] = [];
  disconnected = false;
  constructor(private callback: Callback) {
    FakeObserver.all.push(this);
  }
  observe(options: Record<string, unknown>) {
    this.options = options;
  }
  disconnect() {
    this.disconnected = true;
  }
  takeRecords() {
    const out = this.queued;
    this.queued = [];
    return out;
  }
  emit(...entries: unknown[]) {
    this.callback({ getEntries: () => entries });
  }
  static of(type: string) {
    const found = FakeObserver.all.find((o) => o.options?.type === type);
    if (!found) throw new Error('no observer for ' + type);
    return found;
  }
}

let now = 1000;

beforeEach(() => {
  FakeObserver.all = [];
  FakeObserver.supportedEntryTypes = ['mark', 'measure', 'long-animation-frame', 'layout-shift', 'event', 'paint'];
  now = 1000;
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const mark = (name: string, startTime: number, detail?: unknown) => ({ entryType: 'mark', name, startTime, duration: 0, detail });

describe('createPerfCapture', () => {
  it('observes the supported types with buffered delivery and reports the rest as unsupported', () => {
    const capture = createPerfCapture();
    capture.install();
    expect(FakeObserver.all.map((o) => o.options?.type)).toEqual(['mark', 'measure', 'long-animation-frame', 'layout-shift', 'event', 'paint']);
    expect(FakeObserver.of('mark').options).toMatchObject({ buffered: true });
    expect(FakeObserver.of('event').options).toMatchObject({ durationThreshold: 16 });
    expect(capture.status()).toMatchObject({ enabled: true, unsupported: ['largest-contentful-paint', 'navigation'], windowStart: 1000 });
  });

  it('observes long tasks where long animation frames are unsupported', () => {
    FakeObserver.supportedEntryTypes = ['mark', 'longtask'];
    const capture = createPerfCapture();
    capture.install();
    expect(capture.status().observed).toEqual(['mark', 'longtask']);
    FakeObserver.of('longtask').emit({ entryType: 'longtask', name: 'self', startTime: 1200, duration: 120 });
    expect(capture.entries).toEqual([{ id: 1, entryType: 'longtask', name: 'self', startTime: 1200, duration: 120 }]);
  });

  it('leaves out buffered entries that ended before the window opened', () => {
    const capture = createPerfCapture();
    capture.install();
    FakeObserver.of('mark').emit(mark('old', 900), mark('new', 1100));
    FakeObserver.of('measure').emit({ entryType: 'measure', name: 'spans', startTime: 900, duration: 200 });
    expect(capture.entries.map((e) => e.name)).toEqual(['new', 'spans']);
  });

  it('while paused keeps entries that started before the pause and drops later ones', () => {
    const capture = createPerfCapture();
    capture.install();
    now = 2000;
    capture.pause();
    FakeObserver.of('long-animation-frame').emit({ entryType: 'long-animation-frame', name: 'f', startTime: 1900, duration: 200, blockingDuration: 150 });
    FakeObserver.of('mark').emit(mark('after', 2100));
    expect(capture.entries.map((e) => e.name)).toEqual(['f']);
    expect(capture.status().pausedAt).toBe(2000);
    capture.resume();
    FakeObserver.of('mark').emit(mark('resumed', 2200));
    expect(capture.entries.map((e) => e.name)).toEqual(['f', 'resumed']);
  });

  it('caps each type separately, dropping the oldest of that type', () => {
    const capture = createPerfCapture({ maxPerfEntries: 2 });
    capture.install();
    FakeObserver.of('mark').emit(mark('a', 1001), mark('b', 1002), mark('c', 1003));
    FakeObserver.of('paint').emit({ entryType: 'paint', name: 'first-paint', startTime: 1004, duration: 0 });
    expect(capture.entries.map((e) => e.name)).toEqual(['b', 'c', 'first-paint']);
    expect(capture.status()).toMatchObject({ entries: 3, byType: { mark: 2, paint: 1 }, dropped: { mark: 1 } });
  });

  it('keeps interaction events from 16 ms and other events only from 50 ms', () => {
    const capture = createPerfCapture();
    capture.install();
    FakeObserver.of('event').emit(
      { entryType: 'event', name: 'click', startTime: 1100, duration: 24, interactionId: 4, processingStart: 1101, processingEnd: 1110 },
      { entryType: 'event', name: 'pointerenter', startTime: 1100, duration: 48, interactionId: 0, processingStart: 1101, processingEnd: 1110 },
      { entryType: 'event', name: 'pointerover', startTime: 1200, duration: 160, interactionId: 0, processingStart: 1201, processingEnd: 1350 },
    );
    expect(capture.entries.map((e) => e.name)).toEqual(['click', 'pointerover']);
  });

  it('flush delivers queued records; uninstall flushes and disconnects', () => {
    const capture = createPerfCapture();
    capture.install();
    FakeObserver.of('mark').queued.push(mark('queued', 1100));
    capture.flush();
    expect(capture.entries.map((e) => e.name)).toEqual(['queued']);
    FakeObserver.of('mark').queued.push(mark('late', 1200));
    capture.uninstall();
    expect(capture.entries.map((e) => e.name)).toEqual(['queued', 'late']);
    expect(FakeObserver.all.every((o) => o.disconnected)).toBe(true);
  });

  it('reset empties the capture and reopens the window', () => {
    const capture = createPerfCapture();
    capture.install();
    FakeObserver.of('mark').emit(mark('a', 1100));
    now = 5000;
    capture.reset();
    FakeObserver.of('mark').emit(mark('before-reset', 4000), mark('b', 5100));
    expect(capture.entries).toEqual([{ id: 1, entryType: 'mark', name: 'b', startTime: 5100, duration: 0, detail: null }]);
    expect(capture.status().windowStart).toBe(5000);
  });

  it('does nothing when switched off', () => {
    const capture = createPerfCapture({ perfCapture: false });
    capture.install();
    expect(FakeObserver.all).toEqual([]);
    expect(capture.status()).toMatchObject({ enabled: false, observed: [], entries: 0 });
  });
});

describe('shapePerfEntry', () => {
  it('keeps mark detail as one cut JSON line', () => {
    expect(shapePerfEntry(mark('m', 1.234, { phase: 'ttai', long: 'x'.repeat(300) }))).toMatchObject({
      name: 'm', startTime: 1.2, detail: expect.stringMatching(/^\{"phase":"ttai".*…$/),
    });
  });

  it('keeps the longest scripts of a long animation frame and flags Chippy code', () => {
    const shaped = shapePerfEntry({
      entryType: 'long-animation-frame', name: 'long-animation-frame', startTime: 10, duration: 120, blockingDuration: 70, renderStart: 100, styleAndLayoutStart: 110,
      scripts: [
        { duration: 5, invoker: 'small', sourceURL: 'https://app.test/a.js', sourceCharPosition: -1 },
        { duration: 90, invoker: 'MessagePort.onmessage', invokerType: 'event-listener', sourceURL: 'https://app.test/b.js', sourceFunctionName: 'flush', sourceCharPosition: 42, forcedStyleAndLayoutDuration: 31 },
      ],
    });
    expect(shaped).toMatchObject({ blockingDuration: 70, renderStart: 100, styleAndLayoutStart: 110 });
    expect(shaped?.scripts?.map((s) => [s.invoker, s.duration, s.sourceCharPosition])).toEqual([['MessagePort.onmessage', 90, 42], ['small', 5, null]]);
    expect(shaped?.scripts?.[0].forcedStyleAndLayoutDuration).toBe(31);
  });

  it('splits event timing into input delay, processing, and presentation delay', () => {
    expect(shapePerfEntry({ entryType: 'event', name: 'click', startTime: 100, duration: 80, processingStart: 110, processingEnd: 150, interactionId: 7 })).toMatchObject({
      interactionId: 7, inputDelay: 10, processing: 40, presentationDelay: 30, target: null,
    });
  });

  it('names the owner of layout-shift sources and keeps their rects', () => {
    const node = document.createElement('div');
    node.setAttribute('data-testid', 'card');
    document.body.appendChild(node);
    const shaped = shapePerfEntry({
      entryType: 'layout-shift', name: '', startTime: 5, duration: 0, value: 0.123456, hadRecentInput: false,
      sources: [{ node, previousRect: { x: 0, y: 0, width: 10, height: 10 }, currentRect: { x: 0, y: 20, width: 10, height: 10 } }],
    });
    expect(shaped).toMatchObject({ value: 0.1235, hadRecentInput: false, sources: [{ element: 'div', testId: 'card', previousRect: [0, 0, 10, 10], currentRect: [0, 20, 10, 10] }] });
    node.remove();
  });

  it('reads navigation timing', () => {
    expect(shapePerfEntry({ entryType: 'navigation', name: 'https://app.test/', startTime: 0, duration: 900, type: 'reload', responseStart: 120, domContentLoadedEventEnd: 600, loadEventEnd: 900, transferSize: 5000 })).toMatchObject({
      navigationType: 'reload', ttfb: 120, domContentLoaded: 600, load: 900, transferSize: 5000,
    });
  });

  it('rejects entries without a start time or of unknown types', () => {
    expect(shapePerfEntry({ entryType: 'mark' } as never)).toBeNull();
    expect(shapePerfEntry({ entryType: 'resource', name: 'x', startTime: 1 })).toBeNull();
  });
});
