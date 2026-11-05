#!/usr/bin/env node
// Installs the Chippy agent skill from this package and prints the next steps,
// or packs a custom build with extra plugins (see pack.mjs).
//   npx @atlassian/chippy install [--dir <path>] [--force]
//   npx @atlassian/chippy pack [--config <file>]
import { cpSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isChippySkill, moveAside, ownsDirectory } from './skill-dir.mjs';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEALTH_URL = 'http://127.0.0.1:7823/__chippy/health';

export function defaultSkillDir() {
  return join(homedir(), '.agents', 'skills', 'chippy');
}

// Copies the bundled skill to `target`. An existing Chippy skill is replaced.
// Any other non-empty directory is left alone; with `force` it is renamed to a
// `.replaced-<time>` sibling first, never deleted. Returns the destination, and
// `onMovedAside` receives the backup path.
export function installSkill({ source = join(PACKAGE_ROOT, 'lib', 'mcp-skill'), target = defaultSkillDir(), force = false, onMovedAside = (/** @type {string} */ _backup) => {} } = {}) {
  const destination = resolve(target);
  if (!isChippySkill(source)) throw new Error(`Bundled skill not found at ${source}; build the package first`);
  if ([homedir(), dirname(homedir()), '/', resolve('.')].includes(destination)) {
    throw new Error(`Choose a dedicated skill directory, not ${destination}`);
  }
  if (!ownsDirectory(destination)) {
    if (!force) throw new Error(`${destination} exists and is not a Chippy skill; pass --force to move it aside and install`);
    onMovedAside(moveAside(destination));
  }
  mkdirSync(dirname(destination), { recursive: true });
  rmSync(destination, { recursive: true, force: true });
  cpSync(source, destination, { recursive: true });
  return destination;
}

export function mcpConfig(skillDir) {
  return { mcpServers: { chippy: { command: 'node', args: [join(skillDir, 'scripts', 'chippy-mcp.cjs')] } } };
}

async function helperStatus() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1000) });
    return response.ok ? 'running' : `responded ${response.status}`;
  } catch {
    return 'not running (the MCP server or `chippy.sh start` starts it on demand)';
  }
}

const COMMAND_OPTIONS = { install: ['--dir', '--force'], pack: ['--config'] };
const HELP = new Set(['--help', '-h', 'help']);
const VERSION = new Set(['--version', '-v']);

export function parseArgs(argv) {
  const args = { command: argv[0], dir: undefined, force: false, config: 'chippy.config.mjs', help: false, version: false };
  if (HELP.has(args.command)) return { ...args, command: undefined, help: true };
  if (VERSION.has(args.command)) return { ...args, command: undefined, version: true };
  const allowed = COMMAND_OPTIONS[args.command] ?? [];
  const value = (i) => {
    if (i >= argv.length || argv[i].startsWith('-')) throw new Error(`${argv[i - 1]} needs a value`);
    return argv[i];
  };
  for (let i = 1; i < argv.length; i++) {
    if (HELP.has(argv[i])) args.help = true;
    else if (VERSION.has(argv[i])) args.version = true;
    else if (!allowed.includes(argv[i])) throw new Error(`Unknown option for ${args.command}: ${argv[i]}`);
    else if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--dir') args.dir = value(++i);
    else if (argv[i] === '--config') args.config = value(++i);
  }
  return args;
}

function usage(name) {
  return `Usage: npx ${name} install [--dir <path>] [--force]
       npx ${name} pack [--config <file>]
       npx ${name} --version

install  Installs the Chippy agent skill (default ${defaultSkillDir()}).
         --force moves a directory that is not a Chippy skill aside first.
pack     Builds a custom skill and extension with extra plugins from a config
         file (default chippy.config.mjs). See the package README.
`;
}

async function main(argv) {
  const { name, version } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const args = parseArgs(argv);
  if (args.version) {
    process.stdout.write(`${version}\n`);
    return;
  }
  if (args.help || !COMMAND_OPTIONS[args.command]) {
    process.stdout.write(usage(name));
    process.exitCode = args.help || args.command === undefined ? 0 : 2;
    return;
  }
  if (args.command === 'pack') {
    await pack(args.config);
    return;
  }
  const skillDir = installSkill({
    target: args.dir ?? defaultSkillDir(),
    force: args.force,
    onMovedAside: (backup) => process.stdout.write(`Moved the existing directory to ${backup}\n`),
  });
  process.stdout.write(`Installed the Chippy skill to ${skillDir}

1. Install the browser extension: open chrome://extensions, turn on Developer
   mode, choose Load unpacked, and select this folder:
   ${join(skillDir, 'extension')}${folderPickerHint(skillDir)}
   Without the extension, once your agent has started the helper, run this in
   the page's console:
   import('http://127.0.0.1:7823/__chippy/inject.mjs')

2. Enable Chippy for your page's origin in the extension popup, then ask your
   agent to use Chippy on the page. The agent runs
   ${join(skillDir, 'scripts', 'chippy.sh')}

Optional: connect over MCP if your agent supports it. Ask your agent:
  Connect Chippy over MCP by following ${join(skillDir, 'references', 'mcp.md')}
Or add this server to your agent's MCP configuration yourself:
${JSON.stringify(mcpConfig(skillDir), null, 2).replace(/^/gm, '  ')}

Helper: ${await helperStatus()}
`);
}

// The skill lives in a dot-folder, which folder pickers hide by default.
const FOLDER_PICKER_HINT = {
  darwin: 'The folder is hidden in Finder: press Cmd+Shift+G in the picker and paste the path.',
  win32: 'Paste the path into the picker\'s address bar.',
  linux: 'The folder is hidden: press Ctrl+L in the picker and paste the path.',
};

function folderPickerHint(skillDir) {
  if (!skillDir.split(/[\\/]/).some((part) => part.startsWith('.'))) return '';
  return `\n   ${FOLDER_PICKER_HINT[process.platform] ?? FOLDER_PICKER_HINT.linux}`;
}

async function pack(configPath) {
  // Loaded on demand: install must not depend on the packer.
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
