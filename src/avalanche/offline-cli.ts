// Entry point bundled to .agents/skills/chippy/scripts/avalanche-analyze.cjs.
//   avalanche-analyze.cjs <file> <command> [args]   analyze a saved export
//   avalanche-analyze.cjs normalize [count] < resp  unwrap a helper export response
//   avalanche-analyze.cjs save <count> <file> < resp  unwrap and write it, print {ok,file,bytes,commits}
// A save file ending in `.gz` is written gzip-compressed; any file starting
// with the gzip magic bytes is decompressed on read.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { analyzeSavedReport, keepLastCommits, unwrapSavedReport } from './offline';

const USAGE = `Usage: avalanche-analyze.cjs <file> <command> [args]

Commands:
  summary
  commit-list   [top] [by]                  (--top N --by KEY)
  commit-peek   <commitId> [include] [max]  (--include csv --maxItems N)
  hot-sources   [limit]
  describe-action <actionId>
  network       [top] [by] [match] [initiators] [windowMs]
                (--top N --by start|end|duration --match regex --initiators csv --window ms)
  timeline      [fromCommit] [toCommit] [minRequestMs] [exclude]
                (--fromCommit N --toCommit N --minRequestMs ms --top N --exclude regex --format summary|map|full)
  dom-diff      [fromCommit] [toCommit] [match] [maxItems]
                (--fromCommit N --toCommit N --match regex --maxItems N --top N)
  source-search --name <regex> [--top N]

commit-list sort keys: collateral sources restarts performedWork effects memos
  callbacks contextUpdates unmountedComponents unmountedSubtrees ticks network
commit-peek include values: stats,sources,timing,metrics,hooks,actions,rendered,network,dom
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
  const [file, command, ...rest] = argv;
  if (!command) fail('command missing');
  const report = unwrapSavedReport(parseJson(readSaved(file), file));
  if (!report) fail(`${file} is not an Avalanche export (expected meta and commitStats)`);
  const result = analyzeSavedReport(report, command, parseArgs(rest));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok === false) process.exitCode = 1;
}

main(process.argv.slice(2));
