// Builds a custom Chippy skill and extension from this package: bundles the
// configured plugins into the runtime, sets the build's default plugins and
// extension identity, and applies a documentation overlay.
//   npx @atlassian/chippy pack [--config chippy.config.mjs]
import { execFileSync } from 'node:child_process';
import {
  appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILTIN_PLUGINS = [
  { id: 'jira', label: 'Jira ownership markers' },
  { id: 'atl', label: 'ATL commit metrics' },
];
const RUNTIME_BUNDLES = ['extension/avalanche.iife.js', 'extension/avalanche.es.js'];
const BUILD_CONFIG_CONSUMERS = ['extension/background.js', 'extension/panel-settings.js'];
const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;
const CHROME_VERSION = /^\d+(\.\d+){0,3}$/;

function fail(message) {
  throw new Error(`chippy pack: ${message}`);
}

/** Validates a pack config and resolves its paths against `baseDir`. */
export function normalizePackConfig(config, baseDir) {
  if (!config || typeof config !== 'object') fail('the config must export an object');
  const plugins = (config.plugins ?? []).map((plugin, index) => {
    if (!plugin || typeof plugin !== 'object') fail(`plugins[${index}] must be { id, entry, label? }`);
    if (!PLUGIN_ID.test(plugin.id ?? '')) fail(`plugins[${index}].id must match ${PLUGIN_ID}`);
    if (BUILTIN_PLUGINS.some(({ id }) => id === plugin.id)) fail(`plugin id ${plugin.id} is built in`);
    if (typeof plugin.entry !== 'string') fail(`plugins[${index}].entry must be a path`);
    const entry = resolve(baseDir, plugin.entry);
    if (!existsSync(entry)) fail(`plugin entry not found: ${entry}`);
    return { id: plugin.id, label: plugin.label ?? plugin.id, entry };
  });
  const ids = new Set(plugins.map(({ id }) => id));
  if (ids.size !== plugins.length) fail('plugin ids must be unique');
  const known = new Set([...BUILTIN_PLUGINS.map(({ id }) => id), ...ids]);
  const defaultPlugins = config.defaultPlugins ?? [];
  for (const id of defaultPlugins) if (!known.has(id)) fail(`defaultPlugins names an unknown plugin: ${id}`);
  const extension = config.extension ?? {};
  if (extension.version !== undefined && !CHROME_VERSION.test(extension.version)) {
    fail('extension.version must be one to four dot-separated integers');
  }
  const overlay = config.skill?.overlay ? resolve(baseDir, config.skill.overlay) : null;
  if (overlay && !existsSync(overlay)) fail(`skill overlay not found: ${overlay}`);
  return {
    plugins,
    defaultPlugins: [...defaultPlugins],
    extension,
    overlay,
    outDir: resolve(baseDir, config.outDir ?? 'chippy-build'),
  };
}

/** Imports a pack config module and normalizes it against its own directory. */
export async function loadPackConfig(file) {
  if (!existsSync(file)) fail(`config not found: ${file}`);
  const { default: config } = await import(pathToFileURL(file).href);
  return normalizePackConfig(config, dirname(file));
}

async function loadEsbuild() {
  try {
    return await import('esbuild');
  } catch (error) {
    if (error?.code !== 'ERR_MODULE_NOT_FOUND') throw error;
    fail('bundling plugins needs esbuild; add it to your devDependencies');
  }
}

/** Bundles the plugin registrations and build defaults into one page script. */
export async function bundlePlugins(plugins, defaultPlugins) {
  if (plugins.length === 0 && defaultPlugins.length === 0) return '';
  const lines = plugins.map(({ entry }, index) => `import plugin${index} from ${JSON.stringify(entry)};`);
  lines.push(
    'const api = globalThis.__AVALANCHE__;',
    "if (!api || typeof api.registerPlugin !== 'function') {",
    "  console.warn('[chippy] this build\\'s plugins need a Chippy runtime with registerPlugin()');",
    '} else {',
    ...plugins.map(({ id, label }, index) =>
      `  api.registerPlugin({ ...plugin${index}, id: ${JSON.stringify(id)}, label: ${JSON.stringify(label)} });`),
    `  api.enableDefaultPlugins(${JSON.stringify(defaultPlugins)});`,
    '}',
  );
  const { build } = await loadEsbuild();
  const result = await build({
    stdin: { contents: lines.join('\n'), resolveDir: process.cwd(), sourcefile: 'chippy-plugins.js', loader: 'js' },
    bundle: true, format: 'iife', platform: 'browser', target: 'es2022', write: false, legalComments: 'none',
  });
  return result.outputFiles[0].text;
}

// Inserts `code` before the bundle's sourceMappingURL comment, so the existing
// map still lines up with the core bundle.
function appendToBundle(file, code) {
  const source = readFileSync(file, 'utf8');
  const marker = source.lastIndexOf('\n//# sourceMappingURL=');
  const block = `\n;/* chippy pack: plugins */\n${code}`;
  writeFileSync(file, marker < 0 ? source + block : source.slice(0, marker) + block + source.slice(marker));
}

function prependBuildConfig(file, buildConfig) {
  const source = readFileSync(file, 'utf8');
  writeFileSync(file, `globalThis.__CHIPPY_BUILD = ${JSON.stringify(buildConfig)};\n${source}`);
}

function updateManifest(file, extension) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  if (extension.name) {
    manifest.name = extension.name;
    if (manifest.action) manifest.action.default_title = extension.name;
  }
  for (const field of ['version', 'description', 'key']) {
    if (extension[field] !== undefined) manifest[field] = extension[field];
  }
  writeFileSync(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

// Copies the overlay onto the skill. `<name>.append.md` appends to `<name>.md`.
function applyOverlay(overlay, skillDir) {
  for (const entry of readdirSync(overlay, { recursive: true })) {
    const source = join(overlay, entry);
    if (statSync(source).isDirectory()) continue;
    const appendTarget = entry.match(/^(.*)\.append\.md$/);
    if (appendTarget) {
      const target = join(skillDir, `${appendTarget[1]}.md`);
      if (!existsSync(target)) fail(`overlay ${entry} appends to a missing file: ${relative(skillDir, target)}`);
      appendFileSync(target, `\n${readFileSync(source, 'utf8')}`);
    } else {
      mkdirSync(dirname(join(skillDir, entry)), { recursive: true });
      cpSync(source, join(skillDir, entry));
    }
  }
}

function zip(archive, cwd) {
  rmSync(archive, { force: true });
  execFileSync('zip', ['-qr', archive, '.'], { cwd });
}

/**
 * Writes `<outDir>/chippy` (the skill, with the extension in `extension/`),
 * `<outDir>/chippy-skill.zip`, and `<outDir>/chippy-extension.zip`.
 */
export async function packChippy(config, { source = join(PACKAGE_ROOT, 'dist', 'mcp-skill'), zips = true } = {}) {
  if (!existsSync(join(source, 'SKILL.md'))) fail(`skill not found at ${source}`);
  const { plugins, defaultPlugins, extension, overlay, outDir } = config;
  const code = await bundlePlugins(plugins, defaultPlugins);
  const skillDir = join(outDir, 'chippy');
  rmSync(skillDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(source, skillDir, {
    recursive: true,
    filter: (path) => !['.DS_Store', '.gaps', '.provenance', '__MACOSX'].includes(path.split('/').at(-1)),
  });
  if (code) for (const bundle of RUNTIME_BUNDLES) appendToBundle(join(skillDir, bundle), code);
  const buildConfig = {
    plugins: [...BUILTIN_PLUGINS, ...plugins.map(({ id, label }) => ({ id, label }))],
    defaultPlugins,
  };
  for (const file of BUILD_CONFIG_CONSUMERS) prependBuildConfig(join(skillDir, file), buildConfig);
  updateManifest(join(skillDir, 'extension', 'manifest.json'), extension);
  if (overlay) applyOverlay(overlay, skillDir);
  const license = join(PACKAGE_ROOT, 'LICENSE');
  for (const target of [skillDir, join(skillDir, 'extension')]) {
    if (existsSync(license) && !existsSync(join(target, 'LICENSE'))) cpSync(license, join(target, 'LICENSE'));
  }
  const result = { skillDir };
  if (zips) {
    const stage = join(outDir, '.stage');
    rmSync(stage, { recursive: true, force: true });
    mkdirSync(stage);
    cpSync(skillDir, join(stage, 'chippy'), { recursive: true });
    result.skillZip = join(outDir, 'chippy-skill.zip');
    result.extensionZip = join(outDir, 'chippy-extension.zip');
    zip(result.skillZip, stage);
    zip(result.extensionZip, join(skillDir, 'extension'));
    rmSync(stage, { recursive: true, force: true });
  }
  return result;
}
