// Find fibers carrying a given prop, optionally with a matching value.
// Args:
//   --prop  <name>         REQUIRED. Prop key to look for (exact match).
//   --value <regex>        OPTIONAL. Regex matched against String(propValue) (case-insensitive). Objects/functions become tag strings.
//   --name  <regex>        OPTIONAL. Filter by component displayName regex (case-insensitive).
//   --file  <regex>        OPTIONAL. Filter by _debugSource.fileName regex (case-insensitive).
//   --max   <N>            cap result rows (default 200)
//   --groupBy <name|file|none>  default 'name'. Groups identical components into one row with samples.
//   --depth <N>            depth-trim for sample value (default 2)

const { walkAll, fiberInfo, getDisplayName } = ctx.helpers;
if (!ctx.args.prop) return { error: '--prop <name> is required' };
const propKey = String(ctx.args.prop);
const valueRe = ctx.args.value ? new RegExp(String(ctx.args.value), 'i') : null;
const nameRe = ctx.args.name ? new RegExp(String(ctx.args.name), 'i') : null;
const fileRe = ctx.args.file ? new RegExp(String(ctx.args.file), 'i') : null;
const max = Number(ctx.args.max) || 200;
const groupBy = ['name', 'file', 'none'].includes(String(ctx.args.groupBy)) ? String(ctx.args.groupBy) : 'name';
const depth = Number.isFinite(Number(ctx.args.depth)) ? Math.max(0, Number(ctx.args.depth) | 0) : 2;

function tagOf(v) {
  if (v == null) return String(v);
  const t = typeof v;
  if (t === 'function') return '[Function ' + (v.name || 'anonymous') + ']';
  if (t === 'object') return Array.isArray(v) ? '[Array len=' + v.length + ']' : '[Object]';
  return String(v);
}

function trim(value, d) {
  if (d <= 0 || value == null) {
    if (value && typeof value === 'object') return Array.isArray(value) ? '[Array]' : '[Object]';
    return value;
  }
  if (Array.isArray(value)) return value.slice(0, 10).map((v) => trim(v, d - 1));
  if (typeof value === 'object') {
    const out = {};
    let n = 0;
    for (const k of Object.keys(value)) {
      if (n++ > 20) { out._truncated = true; break; }
      try { out[k] = trim(value[k], d - 1); } catch (_) { out[k] = '[Unserializable]'; }
    }
    return out;
  }
  if (typeof value === 'function') return '[Function ' + (value.name || 'anonymous') + ']';
  return value;
}

const groups = new Map();
let scanned = 0;
let matched = 0;

walkAll((f) => {
  scanned++;
  const props = f?.memoizedProps;
  if (!props || typeof props !== 'object') return;
  if (!Object.prototype.hasOwnProperty.call(props, propKey)) return;
  const name = getDisplayName(f) || '<anonymous>';
  if (nameRe && !nameRe.test(name)) return;
  const file = f?._debugSource?.fileName || f?.type?._debugSource?.fileName || null;
  if (fileRe && !fileRe.test(file || '')) return;
  const v = props[propKey];
  const tag = tagOf(v);
  if (valueRe && !valueRe.test(tag) && !(typeof v === 'string' && valueRe.test(v))) return;
  matched++;
  const key = groupBy === 'name' ? name
            : groupBy === 'file' ? (file || '<no-source>')
            : (name + '|' + (file || '') + '|' + (f?._debugSource?.lineNumber || ''));
  let rec = groups.get(key);
  if (!rec) { rec = { key, name, file, line: f?._debugSource?.lineNumber || null, count: 0, samples: [] }; groups.set(key, rec); }
  rec.count++;
  if (rec.samples.length < 3) {
    rec.samples.push({
      self: fiberInfo(f),
      owner: f._debugOwner ? fiberInfo(f._debugOwner) : null,
      propValueTag: tag,
      propValue: trim(v, depth),
    });
  }
});

const rows = Array.from(groups.values()).sort((a, b) => b.count - a.count).slice(0, max);
ctx.log.push('scanned: ' + scanned + ' matched: ' + matched + ' groups: ' + groups.size);
return { propKey, totalFibers: scanned, matched, groups: groups.size, top: rows };
