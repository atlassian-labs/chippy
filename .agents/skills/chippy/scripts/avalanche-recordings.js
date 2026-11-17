// Saves recordings that a page's Chippy panel sends (Record, then Stop) as
// Avalanche export files that `avalanche-offline` reads, and lists them.
//
// The page chooses nothing about the file: the helper names it from the time
// and a sanitized client id, inside its own recordings directory.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_LISTED = 50;
const HEADER_SUFFIX = '.recording';

function defaultRecordingsDir() {
  return process.env.CHIPPY_RECORDINGS_DIR || path.join(os.tmpdir(), 'chippy-recordings');
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function commitCount(payload) {
  const stats = payload && typeof payload === 'object' ? payload.commitStats : null;
  return stats && typeof stats === 'object' ? Object.keys(stats).length : 0;
}

function isExport(payload) {
  return !!payload && typeof payload === 'object' && !!payload.meta && !!payload.commitStats;
}

function createRecordingStore({ dir = defaultRecordingsDir(), now = () => new Date() } = {}) {
  function save({ clientId, page, startedAt, stoppedAt, payload }) {
    if (!isExport(payload)) return { ok: false, error: 'The recording has no Avalanche export (expected meta and commitStats).' };
    const at = now();
    const safeClient = String(clientId || 'page').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 36) || 'page';
    const base = path.join(dir, `${at.toISOString().replace(/[:.]/g, '-')}-${safeClient}`);
    const file = `${base}.json`;
    const recording = {
      clientId: clientId ? String(clientId) : null,
      url: typeof page?.url === 'string' ? page.url : null,
      title: typeof page?.title === 'string' ? page.title : null,
      startedAt: finiteOrNull(startedAt),
      stoppedAt: finiteOrNull(stoppedAt),
      savedAt: at.toISOString(),
      commits: commitCount(payload),
    };
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ recording, payload }));
      // A small header beside it, so listing does not parse large exports.
      fs.writeFileSync(`${base}${HEADER_SUFFIX}`, JSON.stringify({ ...recording, file }));
    } catch (error) {
      return { ok: false, error: `Could not write ${file}: ${error.message}` };
    }
    return { ok: true, file, commits: recording.commits, bytes: fs.statSync(file).size };
  }

  // Newest first, from the header files.
  function list() {
    let names = [];
    try { names = fs.readdirSync(dir).filter((name) => name.endsWith(HEADER_SUFFIX)); } catch { return []; }
    return names.sort().reverse().slice(0, MAX_LISTED).map((name) => {
      const file = path.join(dir, name.slice(0, -HEADER_SUFFIX.length) + '.json');
      let header = {};
      try { header = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) || {}; } catch {}
      return { ...header, file };
    });
  }

  return { dir, save, list };
}

module.exports = { createRecordingStore, defaultRecordingsDir };
