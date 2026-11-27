// Entry point bundled to .agents/skills/chippy/scripts/avalanche-analyze.cjs.
//   avalanche-analyze.cjs <file> <command> [args]   analyze a saved export
//   avalanche-analyze.cjs normalize [count] < resp  unwrap a helper export response
//   avalanche-analyze.cjs save <count> <file> < resp  unwrap and write it, print {ok,file,bytes,commits}
//   avalanche-analyze.cjs ab-save <armDir> <fiberStateFile> [label] < resp  write the next A/B sample
//   avalanche-analyze.cjs ab-arm <arm> [--skip N] [--top N]              one arm's stability
//   avalanche-analyze.cjs ab-compare <armA> <armB> [--skip N] [--top N]  arm against arm
// A save file ending in `.gz` is written gzip-compressed; any file starting
// with the gzip magic bytes is decompressed on read.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { analyzeSavedReport, keepLastCommits, unwrapSavedReport } from './offline';
import { summarizeArm } from '../ab/arm';
import { compareArms } from '../ab/compare';
import { loadArm, readJsonFile, writeSample } from '../ab/files';
import { unwrapFiberState } from '../ab/sample';

const USAGE = `Usage: avalanche-analyze.cjs <file> <command> [args]

Commands:
  summary
  commit-list   [top] [by]                  (--top N --by KEY)
  commit-peek   <commitId> [include] [max]  (--include csv --maxItems N)
  hot-sources   [limit]
  describe-action <actionId>
  network       [top] [by] [match] [initiators] [windowMs]
                (--top N --by start|end|duration --match regex --initiators csv --window ms)
  perf          [types] [top] [match] [fromCommit] [toCommit]
                (--types csv --top N --match regex --fromCommit N --toCommit N)
  timeline      [fromCommit] [toCommit] [minRequestMs] [exclude]
                (--fromCommit N --toCommit N --minRequestMs ms --minIdleMs ms --top N --exclude regex --format summary|map|full)
  dom-diff      [fromCommit] [toCommit] [match] [maxItems]
                (--fromCommit N --toCommit N --match regex --maxItems N --top N)
  source-search --name <regex> [--top N]

A/B (an arm is a directory of samples, or comma-separated sample files):
  ab-save    <armDir> <fiberStateFile> [label] < export response
  ab-arm     <arm> [--skip N] [--top N]
  ab-compare <armA> <armB> [--skip N] [--top N]

commit-list sort keys: collateral sources restarts performedWork effects memos
  callbacks contextUpdates unmountedComponents unmountedSubtrees ticks network
commit-peek include values: stats,sources,timing,metrics,hooks,actions,rendered,network,dom,perf
perf types: mark measure long-animation-frame layout-shift event
  largest-contentful-paint paint navigation longtask
`;

function fail(message: string): never {
  process.stderr.write(`avalanche-analyze: ${message}\n`);
  process.exit(2);
}

function parseArgs(argv: string[]) {
  const args: { _: string[]; [flag: string]: unknown } = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) { args._.push(arg); continue; }
    const eq = arg.indexOf('=');
    if (eq > -1) args[arg.slice(2, eq)] = arg.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) args[arg.slice(2)] = argv[++i];
    else args[arg.slice(2)] = true;
  }
  return args;
}

function parseJson(text: string, label: string) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fail(`invalid JSON in ${label}: ${(error as Error).message}`);
  }
}

function readSaved(file: string): string {
  const bytes = readFileSync(file);
  const gzipped = bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
  return (gzipped ? gunzipSync(bytes) : bytes).toString('utf8');
}

function main(argv: string[]) {
  if (!argv.length || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(USAGE);
    return;
  }
  if (argv[0] === 'normalize') {
    const report = unwrapSavedReport(parseJson(readFileSync(0, 'utf8'), 'helper response'));
    if (!report) fail('response has no Avalanche export (expected meta and commitStats); check avalanche-status');
    const trimmed = keepLastCommits(report, Number(argv[1]) || 0);
    process.stdout.write(JSON.stringify(trimmed));
    return;
  }
  if (argv[0] === 'save') {
    // One pass for avalanche-save: a large export no longer goes through shell
    // variables, and the commit count comes from the parsed report.
    const out = argv[2];
    if (!out) fail('save requires <count> <file>');
    const response = parseJson(readFileSync(0, 'utf8'), 'helper response') as { nameRecovery?: unknown; result?: { nameRecovery?: unknown } } | null;
    const report = unwrapSavedReport(response);
    if (!report) fail('response has no Avalanche export (expected meta and commitStats); check avalanche-status');
    // On a production build the export first names components recorded as
    // `Anonymous`; `skipped` above zero means another save names more.
    const nameRecovery = response?.nameRecovery ?? response?.result?.nameRecovery;
    const trimmed = keepLastCommits(report, Number(argv[1]) || 0) as { commitStats?: object };
    const text = JSON.stringify(trimmed);
    // The export repeats the same field names and summaries per rendered
    // component, so gzip at the fastest level already shrinks it many times.
    const data = out.endsWith('.gz') ? gzipSync(text, { level: 1 }) : text;
    writeFileSync(out, data);
    const commits = Object.keys(trimmed.commitStats || {}).length;
    const jsonBytes = Buffer.byteLength(text);
    const bytes = typeof data === 'string' ? jsonBytes : data.length;
    process.stdout.write(`${JSON.stringify({ ok: true, file: out, bytes, ...(bytes !== jsonBytes && { jsonBytes }), commits, ...(nameRecovery ? { nameRecovery } : {}) })}\n`);
    return;
  }
  if (argv[0] === 'ab-save') {
    const [, dir, fiberFile, label] = argv;
    if (!dir || !fiberFile) fail('ab-save requires <armDir> <fiberStateFile> [label]');
    const report = unwrapSavedReport(parseJson(readFileSync(0, 'utf8'), 'helper response'));
    if (!report) fail('response has no Avalanche export (expected meta and commitStats); install Avalanche and run the stimulus first');
    let fiber: ReturnType<typeof unwrapFiberState>;
    try { fiber = unwrapFiberState(readJsonFile(fiberFile)); } catch (error) { fiber = { error: (error as Error).message }; }
    rmSync(fiberFile, { force: true });
    const { file, sample, bytes } = writeSample(dir, {
      label: label || null,
      report: report as Parameters<typeof writeSample>[1]['report'],
      fiberState: 'state' in fiber ? fiber.state : null,
      fiberStateError: 'error' in fiber ? fiber.error : null,
    });
    process.stdout.write(`${JSON.stringify({
      ok: true, file, arm: sample.arm, sample: sample.index, label: sample.label, bytes,
      commits: Object.keys(report.commitStats).length,
      fibers: sample.fiberState?.fiberCount ?? null,
      ...(sample.fiberStateError && { fiberStateError: sample.fiberStateError }),
    })}\n`);
    return;
  }
  if (argv[0] === 'ab-arm' || argv[0] === 'ab-compare') {
    const args = parseArgs(argv.slice(1));
    const want = argv[0] === 'ab-arm' ? 1 : 2;
    if (args._.length < want) fail(argv[0] === 'ab-arm' ? 'ab-arm requires <arm>' : 'ab-compare requires <armA> <armB>');
    let arms;
    try { arms = args._.slice(0, want).map((spec) => loadArm(spec, { skip: args.skip })); } catch (error) { fail((error as Error).message); }
    const result = want === 1 ? summarizeArm(arms[0], { top: args.top }) : compareArms(arms[0], arms[1], { top: args.top });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const [file, command, ...rest] = argv;
  if (!command) fail('command missing');
  const report = unwrapSavedReport(parseJson(readSaved(file), file));
  if (!report) fail(`${file} is not an Avalanche export (expected meta and commitStats)`);
  const result = analyzeSavedReport(report, command, parseArgs(rest));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok === false) process.exitCode = 1;
}

main(process.argv.slice(2));
