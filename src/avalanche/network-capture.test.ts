import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNetworkCapture } from './network-capture';
import { clearOwnRequestsForTest, markOwnRequest } from './own-requests';

type Entry = Record<string, unknown>;

/** A PerformanceObserver stand-in: `deliver` calls back, `queue` waits for takeRecords. */
class FakeObserver {
  static supportedEntryTypes: readonly string[] = ['resource', 'mark'];
  static instances: FakeObserver[] = [];
  observed: Record<string, unknown> | null = null;
  disconnected = false;
  queued: Entry[] = [];
  constructor(private callback: (list: { getEntries(): unknown[] }) => void) {
    FakeObserver.instances.push(this);
  }
  observe(options: Record<string, unknown>): void { this.observed = options; }
  disconnect(): void { this.disconnected = true; }
  takeRecords(): unknown[] {
    const out = this.queued;
    this.queued = [];
    return out;
  }
  deliver(...entries: Entry[]): void { this.callback({ getEntries: () => entries }); }
  queue(...entries: Entry[]): void { this.queued.push(...entries); }
}

const resource = (name: string, startTime: number, responseEnd: number, extra: Entry = {}): Entry => ({
  name, initiatorType: 'fetch', startTime, responseEnd, duration: responseEnd - startTime,
  transferSize: 300, decodedBodySize: 1000, responseStatus: 200, ...extra,
});

let now = 1000;

beforeEach(() => {
  now = 1000;
  FakeObserver.instances = [];
  FakeObserver.supportedEntryTypes = ['resource', 'mark'];
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  clearOwnRequestsForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function installed(options = {}) {
  const capture = createNetworkCapture(options);
  capture.install();
  return { capture, observer: FakeObserver.instances[0] };
}

describe('createNetworkCapture', () => {
  it('observes buffered resource entries and records signals', () => {
    const { capture, observer } = installed();
    expect(observer.observed).toEqual({ type: 'resource', buffered: true });
    observer.deliver(resource('https://app.test/api/items?page=1', 1010.04, 1130.26));

    expect(capture.requests).toEqual([{
      id: 1,
      url: 'https://app.test/api/items?page=1',
      initiatorType: 'fetch',
      startTime: 1010,
      endTime: 1130.3,
      duration: 120.2,
      status: 200,
      cached: false,
      startedBeforeCapture: false,
    }]);
  });

  it('skips entries that ended before the window and flags ones that started before it', () => {
    const { capture, observer } = installed();
    observer.deliver(
      resource('https://app.test/old', 100, 900),
      resource('https://app.test/straddle', 900, 1050),
    );
    expect(capture.requests.map((r) => [r.url, r.startedBeforeCapture])).toEqual([
      ['https://app.test/straddle', true],
    ]);
  });

  it('excludes Chippy assets and counts its own module fetches', () => {
    markOwnRequest('https://app.test/src/App.tsx');
    const { capture, observer } = installed();
    observer.deliver(
      resource('https://app.test/__chippy/avalanche.iife.js', 1001, 1002, { initiatorType: 'script' }),
      resource('chrome-extension://abc/bridge.js', 1001, 1002, { initiatorType: 'script' }),
      resource('https://app.test/src/App.tsx', 1001, 1002),
      resource('https://app.test/src/App.tsx', 1003, 1004, { initiatorType: 'script' }),
    );
    expect(capture.requests.map((r) => r.initiatorType)).toEqual(['script']);
    expect(capture.status().ignoredOwn).toBe(1);
  });

  it('derives status and cache use, with null where timing is hidden', () => {
    const { capture, observer } = installed();
    observer.deliver(
      resource('https://app.test/a', 1001, 1002, { deliveryType: 'cache', transferSize: 0 }),
      resource('https://app.test/b', 1001, 1002, { transferSize: 0, decodedBodySize: 10 }),
      resource('https://cdn.test/c', 1001, 1002, { transferSize: 0, decodedBodySize: 0, responseStatus: 0 }),
    );
    expect(capture.requests.map((r) => [r.cached, r.status])).toEqual([[true, 200], [true, 200], [null, null]]);
  });

  it('cuts long URLs and falls back to startTime + duration without responseEnd', () => {
    const { capture, observer } = installed();
    observer.deliver({ name: 'https://app.test/' + 'x'.repeat(400), startTime: 1001, duration: 9 });
    expect(capture.requests[0].url).toHaveLength(300);
    expect(capture.requests[0]).toMatchObject({ endTime: 1010, initiatorType: 'other' });
  });

  it('drops the oldest requests beyond the limit', () => {
    const { capture, observer } = installed({ maxNetworkRequests: 2 });
    observer.deliver(
      resource('https://app.test/1', 1001, 1002),
      resource('https://app.test/2', 1001, 1002),
      resource('https://app.test/3', 1001, 1002),
    );
    expect(capture.requests.map((r) => r.id)).toEqual([2, 3]);
    expect(capture.status()).toMatchObject({ requests: 2, dropped: 1 });
  });

  it('flush delivers queued entries before a report reads them', () => {
    const { capture, observer } = installed();
    observer.queue(resource('https://app.test/late', 1001, 1002));
    expect(capture.requests).toHaveLength(0);
    capture.flush();
    expect(capture.requests).toHaveLength(1);
  });

  it('reset clears requests and opens a new window', () => {
    const { capture, observer } = installed();
    observer.deliver(resource('https://app.test/1', 1001, 1002));
    now = 2000;
    capture.reset();
    expect(capture.requests).toHaveLength(0);
    observer.deliver(resource('https://app.test/2', 1500, 1900), resource('https://app.test/3', 2001, 2002));
    expect(capture.requests.map((r) => [r.id, r.url])).toEqual([[1, 'https://app.test/3']]);
    expect(capture.status()).toMatchObject({ windowStart: 2000, requests: 1, dropped: 0 });
  });

  it('uninstall flushes and disconnects; reinstall creates a new observer', () => {
    const { capture, observer } = installed();
    observer.queue(resource('https://app.test/q', 1001, 1002));
    capture.uninstall();
    expect(observer.disconnected).toBe(true);
    expect(capture.requests).toHaveLength(1);
    capture.install();
    expect(FakeObserver.instances).toHaveLength(2);
  });

  it('does nothing when disabled or unsupported, and reports why', () => {
    const disabled = createNetworkCapture({ networkCapture: false });
    disabled.install();
    expect(FakeObserver.instances).toHaveLength(0);
    expect(disabled.status()).toMatchObject({ supported: true, enabled: false });

    FakeObserver.supportedEntryTypes = ['mark'];
    const unsupported = createNetworkCapture();
    unsupported.install();
    expect(FakeObserver.instances).toHaveLength(0);
    expect(unsupported.status()).toMatchObject({ supported: false, enabled: true });
  });

  it('keeps requests in flight at pause and drops those that start after it', () => {
    const { capture, observer } = installed();
    observer.deliver(resource('https://app.test/api/before', 1010, 1050));
    now = 1100;
    capture.pause();
    observer.deliver(
      resource('https://app.test/api/in-flight', 1090, 1200),
      resource('https://app.test/api/after', 1150, 1180),
    );
    expect(capture.requests.map((r) => r.url)).toEqual([
      'https://app.test/api/before',
      'https://app.test/api/in-flight',
    ]);
    expect(capture.status().pausedAt).toBe(1100);

    now = 1300;
    capture.reset();
    observer.deliver(resource('https://app.test/api/next', 1310, 1320));
    expect(capture.requests.map((r) => r.url)).toEqual(['https://app.test/api/next']);
    expect(capture.status().pausedAt).toBeNull();
  });
});
