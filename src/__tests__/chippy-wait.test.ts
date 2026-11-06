// @vitest-environment node
// A Node client, like the CLI: its WebSocket sends no Origin header. jsdom would
// send http://localhost:3000, which the helper rejects for these example.test pages.
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { testHelperEnv, withHelperToken } from '../test/helper-auth';

const SKILL = resolve(__dirname, '../../.agents/skills/chippy');
const HELPER = resolve(SKILL, 'scripts/chippy-helper-server.js');
const SHELL = resolve(SKILL, 'scripts/chippy.sh');
const children: ChildProcess[] = [];
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const child of children.splice(0)) child.kill('SIGTERM');
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function freePort() {
  const server = createServer();
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP port assigned');
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

async function waitFor<T>(read: () => Promise<T>, accept: (value: T) => boolean, timeoutMs = 5_000) {
  const started = Date.now();
  let latest: T;
  while (Date.now() - started < timeoutMs) {
    latest = await read();
    if (accept(latest)) return latest;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Timed out waiting for helper state: ${JSON.stringify(latest)}`);
}

async function startHelper() {
  const port = await freePort();
  const child = spawn(process.execPath, [HELPER, '--host', '127.0.0.1', '--port', String(port)], {
    env: testHelperEnv(),
    stdio: 'ignore',
  });
  children.push(child);
  const base = `http://127.0.0.1:${port}/__chippy`;
  await waitFor(
    async () => fetch(`${base}/health`).then((response) => response.ok).catch(() => false),
    Boolean,
  );
  return { base, port };
}

async function openSocket(port: number) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/__chippy/ws`);
  await new Promise<void>((resolveOpen, reject) => {
    socket.addEventListener('open', () => resolveOpen(), { once: true });
    socket.addEventListener('error', () => reject(new Error('WebSocket failed to open')), { once: true });
  });
  return socket;
}

function snapshot(clientId: string, reason: string, intent: string | null, comment: string) {
  return JSON.stringify({
    type: 'snapshot',
    reason,
    clientId,
    bridgeVersion: 'test',
    buildMode: 'dev',
    page: { url: 'http://example.test/story', title: 'Wait fixture', storyId: 'wait-fixture' },
    integration: { kind: 'storybook', who: 'test', source: 'test', reinjectsOnReload: true, reloadAction: 'reload' },
    activated: true,
    probesActive: true,
    snapshot: {
      page: { url: 'http://example.test/story', title: 'Wait fixture', storyId: 'wait-fixture' },
      markers: {
        '1': {
          position: { x: 10, y: 20 },
          docked: false,
          intent,
          comment,
          resolved: {
            confidence: 'high',
            note: null,
            nearestTestId: 'summary-card',
            dom: { tag: 'section', text: 'Summary' },
            component: { name: 'SummaryCard', key: null, props: {}, source: { fileName: '/src/SummaryCard.tsx', lineNumber: 12 }, owners: [], parents: [] },
          },
        },
      },
    },
  });
}

async function connectFixture() {
  const { base, port } = await startHelper();
  const socket = await openSocket(port);
  const clientId = 'wait-client';
  socket.send(snapshot(clientId, 'initial', null, ''));
  await waitFor(
    async () => fetch(`${base}/api/pages/${clientId}/snapshot`, withHelperToken()).then((response) => response.json()),
    (body: any) => body?.snapshot?.markers?.['1']?.intent === null,
  );
  return { base, socket, clientId };
}

describe('Chippy probe annotation wait', () => {
  it('blocks until the browser publishes an annotated probe and returns its subject and intent', async () => {
    const { base, socket, clientId } = await connectFixture();
    const waiting = fetch(`${base}/api/pages/${clientId}/probe-annotations/wait?timeoutMs=2000`, withHelperToken()).then((response) => response.json());

    socket.send(snapshot(clientId, 'marker-annotation-change', 'change', 'Move this below the summary.'));

    await expect(waiting).resolves.toMatchObject({
      ok: true,
      status: 'annotation',
      targetClientId: clientId,
      resolvedFrom: null,
      timeoutMs: 2000,
      event: {
        eventId: 'probe-annotation:1',
        sequence: 1,
        at: expect.any(String),
        clientId,
        reason: 'marker-annotation-change',
        page: { title: 'Wait fixture' },
        integration: { kind: 'storybook' },
        changedProbeIds: ['1'],
        annotations: [{
          probeId: '1',
          intent: 'change',
          comment: 'Move this below the summary.',
          marker: {
            position: { x: 10, y: 20 },
            docked: false,
            intent: 'change',
            comment: 'Move this below the summary.',
            resolved: { nearestTestId: 'summary-card', component: { name: 'SummaryCard' } },
          },
        }],
      },
    });
    socket.close();
  });

  it('keeps an annotation queued when it arrives before wait starts', async () => {
    const { base, socket, clientId } = await connectFixture();
    socket.send(snapshot(clientId, 'marker-annotation-change', 'investigate', 'Why does this rerender?'));
    await waitFor(
      async () => fetch(`${base}/api/pages/${clientId}/snapshot`, withHelperToken()).then((response) => response.json()),
      (body: any) => body?.snapshot?.markers?.['1']?.comment === 'Why does this rerender?',
    );

    const response = await fetch(`${base}/api/pages/${clientId}/probe-annotations/wait?timeoutMs=2000`, withHelperToken());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: 'annotation',
      event: { annotations: [{ probeId: '1', intent: 'investigate', comment: 'Why does this rerender?' }] },
    });
    socket.close();
  });

  it('times out without manufacturing an annotation event', async () => {
    const { base, socket, clientId } = await connectFixture();
    socket.send(snapshot(clientId, 'marker-move', 'change', 'Draft text is not attached yet.'));
    await waitFor(
      async () => fetch(`${base}/api/pages/${clientId}/snapshot`, withHelperToken()).then((response) => response.json()),
      (body: any) => body?.snapshot?.markers?.['1']?.comment === 'Draft text is not attached yet.',
    );
    const response = await fetch(`${base}/api/pages/${clientId}/probe-annotations/wait?timeoutMs=25`, withHelperToken());
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'timeout',
      timeoutMs: 25,
      event: null,
    });
    const invalid = await fetch(`${base}/api/pages/${clientId}/probe-annotations/wait?timeoutMs=0`, withHelperToken());
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toEqual({
      ok: false,
      error: 'timeoutMs must be an integer from 1 through 1800000',
    });
    socket.close();
  });

  it('does not lose the next annotation when a waiting caller disconnects', async () => {
    const { base, socket, clientId } = await connectFixture();
    const controller = new AbortController();
    const abandoned = fetch(`${base}/api/pages/${clientId}/probe-annotations/wait?timeoutMs=2000`, withHelperToken({
      signal: controller.signal,
    })).catch((error) => error.name);
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    controller.abort();
    await expect(abandoned).resolves.toMatch(/^(AbortError|TypeError)$/);

    socket.send(snapshot(clientId, 'marker-annotation-change', 'explain', 'What owns this label?'));
    const replacement = await fetch(`${base}/api/pages/${clientId}/probe-annotations/wait?timeoutMs=2000`, withHelperToken());
    await expect(replacement.json()).resolves.toMatchObject({
      status: 'annotation',
      event: { annotations: [{ probeId: '1', intent: 'explain', comment: 'What owns this label?' }] },
    });
    socket.close();
  });

  it('replays from a cursor so a lost response or a second reader misses nothing', async () => {
    const { base, socket, clientId } = await connectFixture();
    const waitAfter = (after: number, timeoutMs = 2000) => fetch(
      `${base}/api/pages/${clientId}/probe-annotations/wait?timeoutMs=${timeoutMs}&after=${after}`,
      withHelperToken(),
    ).then((response) => response.json());

    const first = waitAfter(0);
    const competing = waitAfter(0);
    socket.send(snapshot(clientId, 'marker-annotation-change', 'change', 'First note'));
    const [one, two] = await Promise.all([first, competing]);
    expect(one).toMatchObject({ status: 'annotation', after: 0, cursor: 1, missed: false, event: { sequence: 1 } });
    expect(two).toMatchObject({ status: 'annotation', cursor: 1, event: { sequence: 1 } });

    // Two notes land while nobody waits; the cursor returns them in order.
    socket.send(snapshot(clientId, 'marker-annotation-change', 'change', 'Second note'));
    await waitFor(
      async () => fetch(`${base}/api/pages/${clientId}/snapshot`, withHelperToken()).then((response) => response.json()),
      (body: any) => body?.snapshot?.markers?.['1']?.comment === 'Second note',
    );
    socket.send(snapshot(clientId, 'marker-annotation-change', 'explain', 'Third note'));
    await waitFor(
      async () => fetch(`${base}/api/pages/${clientId}/snapshot`, withHelperToken()).then((response) => response.json()),
      (body: any) => body?.snapshot?.markers?.['1']?.comment === 'Third note',
    );
    const second = await waitAfter(1);
    expect(second).toMatchObject({ cursor: 2, event: { annotations: [{ comment: 'Second note' }] } });
    // Re-reading the same cursor is idempotent.
    await expect(waitAfter(1)).resolves.toMatchObject({ cursor: 2 });
    await expect(waitAfter(2)).resolves.toMatchObject({ cursor: 3, event: { annotations: [{ comment: 'Third note' }] } });
    await expect(waitAfter(3, 25)).resolves.toMatchObject({ status: 'timeout', after: 3, cursor: 3, event: null });

    const invalid = await fetch(`${base}/api/pages/${clientId}/probe-annotations/wait?timeoutMs=25&after=-1`, withHelperToken());
    expect(invalid.status).toBe(400);
    socket.close();
  });

  it('acknowledges an event by asking the page to clear only the annotation it carried', async () => {
    const { base, socket, clientId } = await connectFixture();
    const commands: any[] = [];
    socket.addEventListener('message', (message) => {
      const parsed = JSON.parse(String(message.data));
      if (parsed.type === 'command') commands.push(parsed.command);
    });
    socket.send(snapshot(clientId, 'marker-annotation-change', 'change', 'click it?'));
    const delivered = await fetch(`${base}/api/pages/${clientId}/probe-annotations/wait?timeoutMs=2000&after=0`, withHelperToken())
      .then((response) => response.json());

    const ack = (sequence: unknown) => fetch(`${base}/api/pages/${clientId}/probe-annotations/ack`, withHelperToken({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sequence }),
    }));
    const acked = await ack(delivered.cursor);
    expect(acked.status).toBe(200);
    await expect(acked.json()).resolves.toMatchObject({ ok: true, status: 'acknowledged', sequence: 1, cursor: 1, clearRequested: ['1'] });
    await waitFor(async () => commands, (list) => list.some((command) => command.type === 'clear-probe-annotation'));
    expect(commands.find((command) => command.type === 'clear-probe-annotation')).toEqual({
      type: 'clear-probe-annotation',
      markerId: '1',
      expected: { intent: 'change', comment: 'click it?' },
    });
    expect((await ack(99)).status).toBe(404);
    expect((await ack('x')).status).toBe(400);
    socket.close();
  });

  it('routes the public shell command to the helper without touching host hooks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'chippy-wait-'));
    temporaryDirectories.push(directory);
    const capturePath = join(directory, 'url.txt');
    const fakeCurl = join(directory, 'curl');
    writeFileSync(fakeCurl, `#!/bin/sh
output_file=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o|-w|-X|-H|-d) [ "$1" = "-o" ] && output_file="$2"; shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '{"ok":true}' > "$output_file"
printf '%s' "$url" > "$CHIPPY_CAPTURE_PATH"
printf '200'
`);
    chmodSync(fakeCurl, 0o755);

    execFileSync('bash', [SHELL, 'wait', 'client-42', '17'], {
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH || ''}`,
        CHIPPY_CAPTURE_PATH: capturePath,
      },
    });

    expect(readFileSync(capturePath, 'utf8')).toBe(
      'http://127.0.0.1:7823/__chippy/api/pages/client-42/probe-annotations/wait?timeoutMs=17000',
    );
    const runShell = (...args: string[]) => execFileSync('bash', [SHELL, ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${directory}:${process.env.PATH || ''}`, CHIPPY_CAPTURE_PATH: capturePath },
    });
    runShell('wait', 'client-42', '17', '5');
    expect(readFileSync(capturePath, 'utf8')).toBe(
      'http://127.0.0.1:7823/__chippy/api/pages/client-42/probe-annotations/wait?timeoutMs=17000&after=5',
    );
    runShell('ack', 'client-42', '5');
    expect(readFileSync(capturePath, 'utf8')).toBe(
      'http://127.0.0.1:7823/__chippy/api/pages/client-42/probe-annotations/ack',
    );
    const help = execFileSync('bash', [SHELL, 'help'], { encoding: 'utf8' });
    expect(help).toContain('wait <clientId> [timeoutSeconds] [afterSequence]');
    expect(help).toContain('ack <clientId> <sequence>');
    const executableSurface = [
      SHELL,
      HELPER,
      resolve(SKILL, 'scripts/probe-annotation-channel.js'),
    ].map((file) => readFileSync(file, 'utf8')).join('\n');
    expect(executableSurface).not.toMatch(
      /codex\/hooks|\.cursor\/hooks|\.claude\/settings|UserPromptSubmit|beforeSubmitPrompt/,
    );
  });
});
