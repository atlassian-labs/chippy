// Entry point bundled to .agents/skills/chippy/scripts/avalanche-analyze.cjs.
//   avalanche-analyze.cjs <file> <command> [args]   analyze a saved export
//   avalanche-analyze.cjs normalize [count] < resp  unwrap a helper export response
import { readFileSync } from 'node:fs';
import { analyzeSavedReport, keepLastCommits, unwrapSavedReport } from './offline';

const USAGE = `Usage: avalanche-analyze.cjs <file> <command> [args]

Commands:
  summary
  commit-list   [top] [by]                  (--top N --by KEY)
  commit-peek   <commitId> [include] [max]  (--include csv --maxItems N)
  hot-sources   [limit]
  describe-action <actionId>
  source-search --name <regex> [--top N]

commit-list sort keys: collateral sources restarts performedWork effects memos
  callbacks contextUpdates unmountedComponents unmountedSubtrees ticks
commit-peek include values: stats,sources,timing,metrics,actions,rendered (atl: deprecated alias of metrics)
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
  const [file, command, ...rest] = argv;
  if (!command) fail('command missing');
  const report = unwrapSavedReport(parseJson(readFileSync(file, 'utf8'), file));
  if (!report) fail(`${file} is not an Avalanche export (expected meta and commitStats)`);
  const result = analyzeSavedReport(report, command, parseArgs(rest));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok === false) process.exitCode = 1;
}

main(process.argv.slice(2));
