import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PLUGIN_API = resolve(__dirname, '../package/plugin.ts');

/** A workspace with one context-provider plugin and a skill overlay. */
export function writePackWorkspace(directory: string) {
  mkdirSync(join(directory, 'src'));
  writeFileSync(join(directory, 'src/gate.ts'), `
import { definePlugin, getDisplayName } from ${JSON.stringify(PLUGIN_API)};
export default definePlugin({
  id: 'gate',
  contextProvider: {
    id: 'gate',
    kinds: [{ kind: 'gate', label: 'gate', accent: '#6554c0' }],
    describe(fibers) {
      const index = fibers.findIndex((fiber) => getDisplayName(fiber.type) === 'FeatureGate');
      return { boundaries: { gate: index < 0 ? null : { distance: index } } };
    },
  },
});
`);
  mkdirSync(join(directory, 'overlay/references'), { recursive: true });
  writeFileSync(join(directory, 'overlay/references/gates.md'), '# Feature gates\n');
  writeFileSync(join(directory, 'overlay/SKILL.append.md'), 'See [feature gates](references/gates.md).\n');
  return directory;
}
