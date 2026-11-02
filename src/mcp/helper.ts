import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

export function createHelperConnection(skillDirectory: string, port = 7823) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('CHIPPY_HELPER_PORT must be an integer from 1 through 65535');
  const version = JSON.parse(readFileSync(join(skillDirectory, 'extension/manifest.json'), 'utf8')).version;
  const base = `http://127.0.0.1:${port}/__chippy`;
  // New helpers bind loopback; CHIPPY_HELPER_HOST opts into a wider bind.
  const bindHost = process.env.CHIPPY_HELPER_HOST || '127.0.0.1';
  let starting: Promise<void> | null = null;
  let startedPid: number | null = null;
  // Load the helper's own access module so the token location has one owner.
  const helperAccess = createRequire(__filename)(join(skillDirectory, 'scripts/helper-access.js'));

  async function health(): Promise<boolean> {
    let response: Response;
    try { response = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) }); }
    catch (error: any) {
      if (error.cause?.code === 'ECONNREFUSED') return false;
      throw new Error(`Cannot reach Chippy helper at ${base}: ${error.message}`);
    }
    let payload: any;
    try { payload = await response.json(); } catch { throw new Error(`Port ${port} is occupied by a service without a Chippy health response`); }
    if (!response.ok || payload.ok !== true || payload.version !== version || typeof payload.now !== 'string') {
      throw new Error(`Incompatible helper on port ${port}; expected Chippy ${version}. Stop or upgrade it explicitly.`);
    }
    return true;
  }

  async function start() {
    if (await health()) return;
    const child = spawn(process.execPath, [join(skillDirectory, 'scripts/chippy-helper-server.js'), '--host', bindHost, '--port', String(port)], {
      detached: true, stdio: 'ignore',
    });
    let spawnError: Error | null = null;
    child.on('error', error => { spawnError = error; });
    startedPid = child.pid ?? null;
    child.unref();
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (await health()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    // Kill only our failed startup process; never signal a reused helper.
    child.kill();
    startedPid = null;
    throw new Error(`Chippy helper did not become ready at ${base}; check host process/network permissions`);
  }

  async function ensure() {
    if (!starting) starting = start().finally(() => { starting = null; });
    await starting;
  }

  // Read on each request: a restarted helper writes a new token.
  function authHeaders(headers: Record<string, string>) {
    const token = helperAccess.readHelperToken(port);
    return token ? { ...headers, [helperAccess.TOKEN_HEADER]: token } : headers;
  }

  async function request(path: string, body?: unknown, signal?: AbortSignal, timeoutMs = 15000): Promise<any> {
    await ensure();
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: authHeaders(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
    });
    const payload = await response.json();
    return response.ok ? payload : { ...payload, ok: false, httpStatus: response.status };
  }

  return { ensure, request, status: () => ({ helperUrl: base, startedPid, lifetime: 'persistent' }) };
}
export type HelperConnection = ReturnType<typeof createHelperConnection>;
