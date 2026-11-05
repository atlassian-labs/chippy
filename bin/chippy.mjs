#!/usr/bin/env node
// Installs the Chippy agent skill from this package and prints the next steps,
// or packs a custom build with extra plugins (see pack.mjs).
//   npx @atlassian/chippy install [--dir <path>] [--force]
//   npx @atlassian/chippy pack [--config <file>]
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HEALTH_URL = 'http://127.0.0.1:7823/__chippy/health';

export function defaultSkillDir() {
  return join(homedir(), '.agents', 'skills', 'chippy');
}

function isChippySkill(directory) {
  const skill = join(directory, 'SKILL.md');
  return existsSync(skill) && /^name:\s*chippy\s*$/m.test(readFileSync(skill, 'utf8'));
}

// Copies the bundled skill to `target`. An existing Chippy skill is replaced;
// any other existing directory is left alone unless `force` is set.
export function installSkill({ source = join(PACKAGE_ROOT, 'lib', 'mcp-skill'), target = defaultSkillDir(), force = false } = {}) {
  const destination = resolve(target);
  if (!isChippySkill(source)) throw new Error(`Bundled skill not found at ${source}; build the package first`);
  if ([homedir(), dirname(homedir()), '/', resolve('.')].includes(destination)) {
    throw new Error(`Choose a dedicated skill directory, not ${destination}`);
  }
  if (existsSync(destination) && !isChippySkill(destination) && !force) {
    throw new Error(`${destination} exists and is not a Chippy skill; pass --force to replace it`);
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

function parseArgs(argv) {
  const args = { command: argv[0], dir: undefined, force: false, config: 'chippy.config.mjs' };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === '--force') args.force = true;
    else if (argv[i] === '--dir') args.dir = argv[++i];
    else if (argv[i] === '--config') args.config = argv[++i];
    else throw new Error(`Unknown option: ${argv[i]}`);
  }
  return args;
}

async function main(argv) {
  const { name } = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'));
  const args = parseArgs(argv);
  if (args.command === 'pack') {
    await pack(args.config);
    return;
  }
  if (args.command !== 'install') {
    process.stdout.write(`Usage: npx ${name} install [--dir <path>] [--force]
       npx ${name} pack [--config <file>]

install  Installs the Chippy agent skill (default ${defaultSkillDir()}).
pack     Builds a custom skill and extension with extra plugins from a config
         file (default chippy.config.mjs). See the package README.
`);
    process.exitCode = args.command === undefined || args.command === '--help' ? 0 : 2;
    return;
  }
  const skillDir = installSkill({ target: args.dir ?? defaultSkillDir(), force: args.force });
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
