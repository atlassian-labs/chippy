#!/usr/bin/env node
// Packs a custom Chippy build with extra plugins (see pack.mjs). The agent
// skill is installed with the skills CLI, not by this package.
//   npx @atlassian/chippy pack [--config <file>]
import { readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SKILL_INSTALL_COMMAND = 'npx skills add atlassian-labs/chippy --skill chippy -g';

const COMMAND_OPTIONS = { pack: ['--config'] };
const HELP = new Set(['--help', '-h', 'help']);
const VERSION = new Set(['--version', '-v']);

export function parseArgs(argv) {
  const args = { command: argv[0], config: 'chippy.config.mjs', help: false, version: false };
  if (HELP.has(args.command)) return { ...args, command: undefined, help: true };
  if (VERSION.has(args.command)) return { ...args, command: undefined, version: true };
  if (args.command === 'install') return args;
  const allowed = COMMAND_OPTIONS[args.command] ?? [];
  const value = (i) => {
    if (i >= argv.length || argv[i].startsWith('-')) throw new Error(`${argv[i - 1]} needs a value`);
    return argv[i];
  };
  for (let i = 1; i < argv.length; i++) {
    if (HELP.has(argv[i])) args.help = true;
    else if (VERSION.has(argv[i])) args.version = true;
    else if (!allowed.includes(argv[i])) throw new Error(`Unknown option for ${args.command}: ${argv[i]}`);
    else if (argv[i] === '--config') args.config = value(++i);
  }
  return args;
}

function usage(name) {
  return `Usage: npx ${name} pack [--config <file>]
       npx ${name} --version

pack     Builds a custom skill and extension with extra plugins from a config
         file (default chippy.config.mjs). See the package README.

Install the Chippy agent skill with the skills CLI:
  ${SKILL_INSTALL_COMMAND}
`;
}

// The skill used to be installed by this package; point earlier instructions
// at the skills CLI instead of failing with a bare usage message.
function installMoved() {
  return `This package no longer installs the Chippy skill. Install it with the skills CLI:
  ${SKILL_INSTALL_COMMAND}
Drop -g to install it in the current project only.
`;
}

async function main(argv) {
  const { name, version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const args = parseArgs(argv);
  if (args.version) {
    process.stdout.write(`${version}\n`);
    return;
  }
  if (args.command === 'install') {
    process.stderr.write(installMoved());
    process.exitCode = 1;
    return;
  }
  if (args.help || !COMMAND_OPTIONS[args.command]) {
    process.stdout.write(usage(name));
    process.exitCode = args.help || args.command === undefined ? 0 : 2;
    return;
  }
  await pack(args.config);
}

async function pack(configPath) {
  const { loadPackConfig, packChippy } = await import('./pack.mjs');
  const result = await packChippy(await loadPackConfig(resolve(configPath)));
  process.stdout.write(`Packed Chippy:
  skill      ${result.skillDir}
  skill zip  ${result.skillZip}
  extension  ${result.extensionZip}
`);
}

// npx and global installs start the bin through a symlink, so compare real paths.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
