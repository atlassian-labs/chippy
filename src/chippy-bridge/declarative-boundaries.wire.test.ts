import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const SHELL = resolve(SKILL, 'scripts/chippy.sh');
const HELPER = resolve(SKILL, 'scripts/chippy-helper-server.js');
const BRIDGE = resolve(SKILL, 'extension/chippy-page-bridge.js');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function captureShellBody(args: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'chippy-boundaries-'));
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

  execFileSync('bash', [SHELL, ...args], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${directory}:${process.env.PATH || ''}`,
      CHIPPY_CAPTURE_PATH: capturePath,
    },
  });
  return JSON.parse(readFileSync(capturePath, 'utf8'));
}

describe('declarative boundary command wire chain', () => {
  it('sends probe id and max from the real probe-boundaries shell command', () => {
    expect(captureShellBody(['probe-boundaries', 'client-1', '2', '17'])).toEqual({
      command: 'eval-probe-boundaries',
      probeId: '2',
      max: 17,
    });
  });

  it('sends max from the real page-boundaries shell command', () => {
    expect(captureShellBody(['page-boundaries', 'client-1', '321'])).toEqual({
      command: 'page-boundaries',
      max: 321,
    });
  });

  it('sends fiber id and max from the real inspect-fiber-boundaries shell command', () => {
    expect(captureShellBody(['inspect-fiber-boundaries', 'client-1', 'fiber:9', '23'])).toEqual({
      command: 'inspect-fiber-boundaries',
      fiberId: 'fiber:9',
      max: 23,
    });
  });

  it('applies the documented shell defaults for each boundary view', () => {
    expect(captureShellBody(['probe-boundaries', 'client-1', '1']).max).toBe(100);
    expect(captureShellBody(['page-boundaries', 'client-1']).max).toBe(1000);
    expect(captureShellBody(['inspect-fiber-boundaries', 'client-1', 'fiber:4']).max).toBe(100);
  });

  it('advertises all three public shell commands', () => {
    const help = execFileSync('bash', [SHELL, 'help'], { encoding: 'utf8' });
    expect(help).toContain('probe-boundaries <clientId> <probeId> [max]');
    expect(help).toContain('page-boundaries <clientId> [max]');
    expect(help).toContain('inspect-fiber-boundaries <clientId> <fiberId> [max]');
  });

  it('accepts each command and forwards max through the helper transport', () => {
    const source = readFileSync(HELPER, 'utf8');
    expect(source).toContain("'eval-probe-boundaries'");
    expect(source).toContain("'page-boundaries'");
    expect(source).toContain("'inspect-fiber-boundaries'");
    expect(source).toContain('if (body.max != null) wsCommand.max = Number(body.max)');
  });

  it('dispatches each command with every required field in the page bridge', () => {
    const source = readFileSync(BRIDGE, 'utf8');
    expect(source.slice(source.indexOf("case 'eval-probe-boundaries'"), source.indexOf("case 'eval-probe-boundaries'") + 300))
      .toContain('evalProbeBoundaries(command.probeId, command.max)');
    expect(source.slice(source.indexOf("case 'page-boundaries'"), source.indexOf("case 'page-boundaries'") + 260))
      .toContain('evalPageBoundaries(command.max)');
    expect(source.slice(source.indexOf("case 'inspect-fiber-boundaries'"), source.indexOf("case 'inspect-fiber-boundaries'") + 320))
      .toContain('evalInspectFiberBoundaries(command.fiberId, command.max)');
  });

  it('keeps bridge shims thin and delegates both algorithms to the bundle', () => {
    const source = readFileSync(BRIDGE, 'utf8');
    expect(source).toContain('b.inspectDeclarativeBoundaryChain(fiber, max');
    expect(source).toContain('b.inspectPageDeclarativeBoundaries(max');
  });
});
