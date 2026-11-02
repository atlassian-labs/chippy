import { describe, it, expect, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, renameSync, existsSync, cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { testHelperEnv } from './test/helper-auth';

/**
 * Contract for serving EXTENSION_ROOT assets (avalanche.iife.js, avalanche.es.js,
 * devtools-hook-shim.js) from the Chippy helper.
 *
 * Regression: a missing asset used to return HTTP 500 with a bare error, which
 * Playwright's addScriptTag surfaced only as "Failed to load script" — opaque and
 * hard to diagnose. It must instead be a 404 with a resolved path + actionable hint.
 */

const SKILL = resolve(__dirname, '../.agents/skills/chippy');
const HELPER = resolve(SKILL, 'scripts/chippy-helper-server.js');

describe('helper extension-asset serving (source contract)', () => {
  const src = readFileSync(HELPER, 'utf8');

  it('routes generated/asset files through serveExtensionFile', () => {
    expect(src).toContain('function serveExtensionFile(');
    expect(src).toContain("serveExtensionFile(res, 'avalanche.iife.js'");
    expect(src).toContain("serveExtensionFile(res, 'avalanche.es.js'");
    expect(src).toContain("serveExtensionFile(res, 'devtools-hook-shim.js'");
  });

  it('missing asset is a 404 (not 500) with an actionable hint', () => {
    const idx = src.indexOf('function serveExtensionFile(');
    const block = src.slice(idx, idx + 900);
    expect(block).toContain("e.code === 'ENOENT'");
    expect(block).toContain('json(res, 404');
    expect(block).toContain('avalanche:sync'); // hint names the fix for the generated bundle
    expect(block).toContain('extensionRoot'); // includes resolved root for diagnosis
  });
});

describe('helper extension-asset serving (live HTTP)', () => {
  let proc: ChildProcess | undefined;
  let fixtureSkill: string;
  const PORT = 7899; // ephemeral, avoid clashing with a running helper on 7823

  const start = () =>
    new Promise<void>((res, rej) => {
      fixtureSkill = mkdtempSync(resolve(tmpdir(), 'chippy-assets-test-'));
      cpSync(SKILL, fixtureSkill, { recursive: true });
      proc = spawn('node', [resolve(fixtureSkill, 'scripts/chippy-helper-server.js'), '--port', String(PORT)], { env: testHelperEnv(), stdio: 'ignore' });
      proc.on('error', rej);
      const t0 = Date.now();
      const poll = async () => {
        try {
          const r = await fetch(`http://127.0.0.1:${PORT}/__chippy/health`);
          if (r.ok) return res();
        } catch { /* not up yet */ }
        if (Date.now() - t0 > 5000) return rej(new Error('helper did not start'));
        setTimeout(poll, 100);
      };
      poll();
    });

  afterAll(async () => {
    if (proc && proc.exitCode === null) {
      const exited = new Promise<void>(done => proc!.once('exit', () => done()));
      proc.kill();
      await exited;
    }
    if (fixtureSkill) rmSync(fixtureSkill, { recursive: true, force: true });
  });

  it('serves a present asset (200) and rejects a missing one (404 + hint)', async () => {
    await start();

    // present: avalanche.iife.js exists in the workspace extension dir
    const present = await fetch(`http://127.0.0.1:${PORT}/__chippy/avalanche.iife.js?t=1`);
    expect(present.status).toBe(200);

    for (const name of ['avalanche.iife.js.map', 'avalanche.es.js.map']) {
      const response = await fetch(`http://127.0.0.1:${PORT}/__chippy/${name}`);
      expect(response.status).toBe(200);
      const map = await response.json();
      expect(map.version).toBe(3);
      expect(map.sources.length).toBeGreaterThan(0);
      expect(map.sourcesContent).toHaveLength(map.sources.length);
    }

    // query string must not break routing
    const withQuery = await fetch(`http://127.0.0.1:${PORT}/__chippy/avalanche.iife.js?t=cachebust`);
    expect(withQuery.status).toBe(200);

    // missing: temporarily rename a served asset so the ENOENT branch runs live.
    const asset = resolve(fixtureSkill, 'extension/avalanche.es.js');
    const bak = `${asset}.spec-bak`;
    const had = existsSync(asset);
    if (had) renameSync(asset, bak);
    try {
      const missing = await fetch(`http://127.0.0.1:${PORT}/__chippy/avalanche.es.js`);
      expect(missing.status).toBe(404);
      const body = await missing.json();
      expect(body.ok).toBe(false);
      expect(body.error).toContain('avalanche.es.js');
      expect(body.hint).toContain('avalanche:sync');
      expect(body.extensionRoot).toBeTruthy();
    } finally {
      if (had) renameSync(bak, asset);
    }
  }, 15000);
});
