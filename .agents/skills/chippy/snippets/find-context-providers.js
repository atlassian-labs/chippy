// List active modern React Context providers on the page.
// Optional args:
//   --name <regex>   filter by Context displayName / name (case-insensitive)
//   --max  <N>       cap results (default 500)

const { findFibers, fiberInfo, ancestorFibers, getDisplayName } = ctx.helpers;
const nameRe = ctx.args.name ? new RegExp(String(ctx.args.name), 'i') : null;
const max = Number(ctx.args.max) || 500;

// Provider fibers: tag === 10 in modern React, type._context exists.
const fibers = findFibers((f) => {
  const t = f?.type;
  if (!t || typeof t !== 'object') return false;
  // ContextProvider: type._context, $$typeof matches React.createContext output
  return !!t._context;
}, { max: max * 4 });

const seen = new Map(); // key = contextId → { name, count, samples[] }
for (const f of fibers) {
  const ctxObj = f.type._context;
  const name = ctxObj.displayName || ctxObj._currentValue?.displayName || ctxObj?.Provider?.displayName || null;
  if (nameRe && !nameRe.test(name || '')) continue;
  const id = name || ('anon@' + Object.keys(seen).length);
  let rec = seen.get(id);
  if (!rec) { rec = { name, count: 0, samples: [] }; seen.set(id, rec); }
  rec.count++;
  if (rec.samples.length < 3) {
    rec.samples.push({
      provider: fiberInfo(f),
      owner: f._debugOwner ? fiberInfo(f._debugOwner) : null,
      ancestors: ancestorFibers(f, 6).map((a) => a.name),
    });
  }
}

const rows = Array.from(seen.values()).sort((a, b) => b.count - a.count);
ctx.log.push('matched providers: ' + rows.length);
return { totalProviders: rows.length, top: rows.slice(0, max) };
