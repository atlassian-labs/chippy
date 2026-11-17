// On-screen area of components, test ids, placeholders, and content, in
// square CSS pixels. Answers "how much of the modal is still a skeleton?" and,
// with --watch, "when did the header, description, and comments appear?".
//
// READ-ONLY. The capability lives in the bridge bundle
// (src/chippy-bridge/component-area → window.__AVALANCHE__.bridge); this
// snippet only parses arguments.
//
// Areas are unions of on-screen boxes clipped to the root, the viewport, and
// overflow-clipping ancestors, so overlaps count once. A component's area is
// the box of its outermost DOM elements.
//   placeholder  elements rendered as a suspended Suspense fallback, plus
//                components matching --placeholder-names
//   content      text, images, SVG, canvas, video, iframes, and form controls
//                outside placeholders
//
// Args:
//   --root <testid|css>        root element (default: the viewport)
//   --testids <csv>            data-testid values to measure
//   --components <csv>         component display names to measure
//   --placeholder-names <re>   also count matching components as placeholders
//   --auto <N>                 with no targets, measure the N largest test ids (default 15)
//   --min-share <0..1>         auto targets below this share of the root are skipped (default 0.01)
//   --watch start|read|stop    record area changes over time instead of one measurement
//   --interval <ms>            watch: minimum time between measurements (default 50)
//   --poll <ms>                watch: also measure on a fixed period (default off)
//   --duration <ms>            watch: stop after this long (default 30000)
//
// Returns: one measurement { ok, at, root, placeholder, content, targets, stats },
// or for --watch read/stop { ok, active, startedAt, root, placeholder, content, targets, samples }.

const av = window.__AVALANCHE__;
const bridge = av && av.bridge;
if (!bridge || typeof bridge.measureComponentArea !== 'function') {
  return { ok: false, reason: 'bridge-capability-missing (reload the extension and the page)' };
}

const a = ctx.args;
const csv = (v) => (v === undefined || v === null || v === true ? [] : String(v).split(',').map((s) => s.trim()).filter(Boolean));
const num = (v) => (v === undefined || v === null || v === '' ? undefined : Number(v));
const options = {
  root: a.root ? String(a.root) : null,
  testIds: csv(a.testids),
  components: csv(a.components),
  placeholderNames: a['placeholder-names'] ? String(a['placeholder-names']) : null,
  autoTargets: num(a.auto),
  minShare: num(a['min-share']),
};

const watch = a.watch ? String(a.watch) : null;
if (!watch) return bridge.measureComponentArea(options);
if (watch === 'start') {
  return bridge.areaWatch.start({
    ...options,
    intervalMs: num(a.interval),
    pollMs: num(a.poll),
    durationMs: num(a.duration),
  });
}
if (watch === 'read') return bridge.areaWatch.read();
if (watch === 'stop') return bridge.areaWatch.stop();
return { ok: false, reason: 'unknown --watch value: ' + watch + ' (use start, read, or stop)' };
