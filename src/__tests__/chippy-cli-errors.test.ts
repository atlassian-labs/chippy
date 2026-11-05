// @vitest-environment node
// How `chippy.sh` reports a rejected or failed command. The CLI tests stub curl
// with a script that answers by URL and logs each request; the helper tests run
// a real helper on a free port.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const SCRIPTS = resolve(__dirname, '../../.agents/skills/chippy/scripts');
const HELPER = join(SCRIPTS, 'chippy-helper-server.js');

type Reply = { match: string; status: number; body: unknown };

/** Runs `chippy.sh` with a fake curl that returns the first reply whose `match` occurs in the URL. */
function runWithFakeCurl(args: string[], replies: Reply[]) {
  const directory = mkdtempSync(join(tmpdir(), 'chippy-cli-'));
  const log = join(directory, 'requests.log');
  try {
    const cases = replies.map(({ match, status, body }) => `  *${match}*) printf '%s' '${JSON.stringify(body)}' > "$output_file"; printf '${status}' ;;`).join('\n');
    const fakeCurl = join(directory, 'curl');
    writeFileSync(fakeCurl, `#!/bin/sh
output_file=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) output_file="$2"; shift 2 ;;
    http*) url="$1"; shift ;;
    *) shift ;;
  esac
done
echo "$url" >> '${log}'
case "$url" in
${cases}
  *) printf '{"ok":false,"error":"unexpected request"}' > "$output_file"; printf '599' ;;
esac
`);
    chmodSync(fakeCurl, 0o755);
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${directory}:${process.env.PATH || ''}`, CHIPPY_STATE_DIR: directory };
    delete env.CHIPPY_HELPER_TOKEN;
    const run = spawnSync('bash', [join(SCRIPTS, 'chippy.sh'), ...args], { env, encoding: 'utf8', timeout: 30_000 });
    const requests = existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean) : [];
    return { status: run.status, stdout: run.stdout, stderr: run.stderr, requests };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

describe('chippy.sh detection mode', () => {
  it.each([
    ['avalanche-install', ['client-1', 'bogus']],
    ['avalanche-arm', ['client-1', 'http://localhost:5173', '0', 'true', 'bogus']],
  ])('%s rejects an unknown mode before calling the helper', (command, args) => {
    const run = runWithFakeCurl([command, ...args], [{ match: '/api/', status: 200, body: { ok: true } }]);
    expect(run.status).toBe(1);
    expect(run.stderr).toContain(`${command} detectionMode must be sources, full, stats, or amplifiers (got 'bogus')`);
    expect(run.requests).toEqual([]);
  });
});

describe('chippy.sh reload-with-avalanche', () => {
  it('exits 1 with an explanation when the page does not reconnect', () => {
    const run = runWithFakeCurl(
      ['reload-with-avalanche', 'client-1', 'http://localhost:5173', '0', '1000', '0'],
      [
        { match: '/wait-reload', status: 200, body: { ok: true, reloaded: false, clientId: 'client-1', waitedMs: 1000 } },
        { match: '/api/', status: 200, body: { ok: true } },
      ],
    );
    expect(run.status).toBe(1);
    expect(run.stderr).toContain('reload-with-avalanche: the page did not reconnect within 1000ms after the reload.');
    expect(run.stderr).toContain('init: true');
    expect(run.requests.map((url) => new URL(url).pathname.replace(/^\/__chippy/, ''))).toEqual([
      '/api/avalanche-arm',
      '/api/pages/client-1/avalanche',
      '/api/pages/client-1/avalanche',
      '/api/pages/client-1/reload',
      '/api/pages/client-1/wait-reload',
    ]);
  });
});

describe('chippy.sh handoff-to-playwright', () => {
  it('prints the helper error and hint when the handoff fails', () => {
    const run = runWithFakeCurl(['handoff-to-playwright', 'client-1'], [{
      match: '/handoff-to-playwright',
      status: 503,
      body: { ok: false, error: 'Playwright is not installed', hint: 'Run npx playwright install chromium' },
    }]);
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain('http_status=503');
    expect(run.stderr).toContain('error: Playwright is not installed');
    expect(run.stderr).toContain('hint: Run npx playwright install chromium');
  });
});

describe('helper detection mode', () => {
  let helper: ChildProcess;
  let port: number;

  async function freePort() {
    const server = createServer();
    await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
    const value = (server.address() as any).port;
    await new Promise<void>((done) => server.close(() => done()));
    return value;
  }

  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${port}/__chippy${path}`, withHelperToken({
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }));

  beforeAll(async () => {
    port = await freePort();
    helper = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], { env: testHelperEnv(), stdio: 'ignore' });
    const started = Date.now();
    while (Date.now() - started < 10_000) {
      if (await fetch(`http://127.0.0.1:${port}/__chippy/health`).then((r) => r.ok).catch(() => false)) return;
      await new Promise((done) => setTimeout(done, 50));
    }
    throw new Error('helper did not start');
  }, 15_000);

  afterAll(() => { helper?.kill('SIGTERM'); });

  it.each([
    ['/api/avalanche-arm', { clientId: 'client-1', origin: 'http://localhost:5173', autoStart: true, options: { detectionMode: 'bogus' } }],
    ['/api/pages/client-1/avalanche', { action: 'install', options: { detectionMode: 'bogus' } }],
  ])('POST %s answers 400 for an unknown mode', async (path, body) => {
    const response = await post(path, body);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: expect.stringContaining('detectionMode must be one of sources, full, stats, amplifiers') });
  });
});
