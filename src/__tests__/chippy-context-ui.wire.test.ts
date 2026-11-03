import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const SHELL = resolve(SKILL, 'scripts/chippy.sh');
const HELPER = resolve(SKILL, 'scripts/chippy-helper-server.js');
const BRIDGE = resolve(SKILL, 'extension/chippy-page-bridge.js');
const LAYOUT_LAB = resolve(SKILL, 'extension/layout-lab.js');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function captureShellBody(command: 'context-ui', mode: 'on' | 'off') {
  const directory = mkdtempSync(join(tmpdir(), 'chippy-context-ui-'));
  temporaryDirectories.push(directory);
  const capturePath = join(directory, 'body.json');
  const fakeCurl = join(directory, 'curl');
  writeFileSync(fakeCurl, `#!/bin/sh
output_file=""
body=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output_file="$2"; shift 2 ;;
    -d) body="$2"; shift 2 ;;
    *) shift ;;
  esac
done
printf '{"ok":true}' > "$output_file"
printf '%s' "$body" > "$CHIPPY_CAPTURE_PATH"
printf '200'
`);
  chmodSync(fakeCurl, 0o755);

  execFileSync('bash', [SHELL, command, 'client-42', mode], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH || ''}`,
      CHIPPY_CAPTURE_PATH: capturePath,
    },
  });
  return JSON.parse(readFileSync(capturePath, 'utf8'));
}

describe('context-ui wire chain', () => {
  it('invokes the real shell wrapper and sends an enabled command', () => {
    expect(captureShellBody('context-ui', 'on')).toEqual({
      clientId: 'client-42',
      command: { type: 'set-context-ui', enabled: true },
    });
  });

  it('invokes the real shell wrapper and sends a disabled command', () => {
    expect(captureShellBody('context-ui', 'off')).toEqual({
      clientId: 'client-42',
      command: { type: 'set-context-ui', enabled: false },
    });
  });

  it('advertises the public shell command', () => {
    const help = execFileSync('bash', [SHELL, 'help'], { encoding: 'utf8' });
    expect(help).toContain('context-ui <clientId> <on|off>');
    expect(help).not.toContain('jira-ui');
  });

  it('forwards the generic command object unchanged through the helper', () => {
    const source = readFileSync(HELPER, 'utf8');
    const route = source.slice(source.indexOf("p === `${CHIPPY_PREFIX}/api/command`"), source.indexOf("p === `${CHIPPY_PREFIX}/api/command`") + 700);
    expect(route).toContain('const command = body.command || body');
    expect(route).toContain('broadcastCommand(command, body.clientId || null)');
  });

  it('consumes the command in the page bridge and refreshes the panel', () => {
    const source = readFileSync(BRIDGE, 'utf8');
    const commandCase = source.slice(source.indexOf("case 'set-context-ui'"), source.indexOf("case 'set-context-ui'") + 220);
    expect(commandCase).toContain('setContextUiEnabled(command.enabled !== false');
    expect(source).not.toContain('set-jira-ui');
    expect(source).toContain('contextUiEnabled: true');
    expect(source).toContain('chippy.layoutLab?.updatePanel?.()');
  });

  it('keeps marker context hidden when the runtime config disables it', () => {
    const source = readFileSync(LAYOUT_LAB, 'utf8');
    expect(source).toContain('chippy.config?.contextUiEnabled !== false');
    expect(source).toContain('data-chippy-context');
    expect(source).toContain('data-chippy-boundary-marker');
  });
});
