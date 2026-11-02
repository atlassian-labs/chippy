import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildFiberStateCaptureCommand, buildFiberStateCompareCommand } from '../../.agents/skills/chippy/scripts/build-fiber-state-command';

const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const SHELL = resolve(SKILL, 'scripts/chippy.sh');
const HELPER = resolve(SKILL, 'scripts/chippy-helper-server.js');
const BRIDGE = resolve(SKILL, 'extension/chippy-page-bridge.js');
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function captureShellRequest(args: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'chippy-fiber-state-'));
  temporaryDirectories.push(directory);
  const capturePath = join(directory, 'request.json');
  const fakeCurl = join(directory, 'curl');
  writeFileSync(fakeCurl, `#!/bin/sh
output_file=""
body=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output_file="$2"; shift 2 ;;
    -d) body="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
printf '{"ok":true}' > "$output_file"
printf '{"url":"%s","body":%s}' "$url" "$(printf '%s' "$body" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.stringify(s)))')" > "$CHIPPY_CAPTURE_PATH"
printf '200'
`);
  chmodSync(fakeCurl, 0o755);
  execFileSync('bash', [SHELL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, PATH: `${directory}:${process.env.PATH || ''}`, CHIPPY_CAPTURE_PATH: capturePath },
  });
  const request = JSON.parse(readFileSync(capturePath, 'utf8'));
  return { url: request.url as string, body: request.body ? JSON.parse(request.body) : null };
}

describe('fiber state command wire chain', () => {
  it('sends capture label and maxFibers from the real shell command', () => {
    expect(captureShellRequest(['fiber-state-capture', 'client-1', 'gate off', '1234'])).toEqual({
      url: 'http://127.0.0.1:7823/__chippy/api/pages/client-1/fiber-state-captures',
      body: { label: 'gate off', maxFibers: 1234 },
    });
  });

  it('sends both capture ids and maxChanges from the real compare command', () => {
    expect(captureShellRequest(['fiber-state-compare', 'state:before', 'state:after', '17'])).toEqual({
      url: 'http://127.0.0.1:7823/__chippy/api/fiber-state-comparisons',
      body: { before: 'state:before', after: 'state:after', maxChanges: 17 },
    });
  });

  it('builds exact page commands without dropping capture or comparison fields', () => {
    const before = { version: 1, fibers: [{ id: 'a' }] };
    const after = { version: 1, fibers: [{ id: 'b' }] };
    expect(buildFiberStateCaptureCommand({ maxFibers: 1234 })).toEqual({
      type: 'capture-fiber-state', options: { maxFibers: 1234 },
    });
    expect(buildFiberStateCompareCommand(before, after, { maxChanges: 17 })).toEqual({
      type: 'compare-fiber-states', before, after, options: { maxChanges: 17 },
    });
  });

  it('uses the builders in the helper routes', () => {
    const source = readFileSync(HELPER, 'utf8');
    expect(source).toContain('requestProbeCommand(clientId, buildFiberStateCaptureCommand(body)');
    expect(source).toContain('requestProbeCommand(compareClientId, buildFiberStateCompareCommand(');
    expect(source).toContain('fiberStateCaptures = new Map()');
  });

  it('dispatches capture and comparison with all fields in the page bridge', () => {
    const source = readFileSync(BRIDGE, 'utf8');
    const captureCase = source.slice(source.indexOf("case 'capture-fiber-state'"), source.indexOf("case 'capture-fiber-state'") + 300);
    const compareCase = source.slice(source.indexOf("case 'compare-fiber-states'"), source.indexOf("case 'compare-fiber-states'") + 350);
    expect(captureCase).toContain('evalCaptureFiberState(command.options || {})');
    expect(compareCase).toContain('evalCompareFiberStates(command.before, command.after, command.options || {})');
  });

  it('advertises all public commands and their defaults', () => {
    const help = execFileSync('bash', [SHELL, 'help'], { encoding: 'utf8' });
    expect(help).toContain('fiber-state-capture <clientId> [label] [maxFibers]');
    expect(help).toContain('fiber-state-list');
    expect(help).toContain('fiber-state-compare <beforeCaptureId> <afterCaptureId> [maxChanges]');
    expect(captureShellRequest(['fiber-state-capture', 'client-1']).body.maxFibers).toBe(100000);
    expect(captureShellRequest(['fiber-state-compare', 'a', 'b']).body.maxChanges).toBe(200);
  });

  it('rejects non-positive capture and comparison limits before transport', () => {
    expect(() => captureShellRequest(['fiber-state-capture', 'client-1', 'bad', '0'])).toThrow(/positive integer/);
    expect(() => captureShellRequest(['fiber-state-compare', 'a', 'b', '0'])).toThrow(/positive integer/);
  });
});
