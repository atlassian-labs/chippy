// Find class components using the legacy React context API.
// Producer:   class with `childContextTypes`
// Consumer:   class with `contextTypes`
// Args:
//   --name <regex>   filter by component displayName / name
//   --kind <producer|consumer|both>   default both
//   --max  <N>       default 500

const { findFibers, fiberInfo, ancestorFibers, getDisplayName } = ctx.helpers;
const nameRe = ctx.args.name ? new RegExp(String(ctx.args.name), 'i') : null;
const kind = String(ctx.args.kind || 'both');
const max = Number(ctx.args.max) || 500;

function classifies(t) {
  if (!t) return null;
  const isProducer = !!t.childContextTypes && Object.keys(t.childContextTypes).length > 0;
  const isConsumer = !!t.contextTypes && Object.keys(t.contextTypes).length > 0;
  if (!isProducer && !isConsumer) return null;
  return { isProducer, isConsumer };
}

const fibers = findFibers((f) => !!classifies(f?.type), { max: max * 4 });
const groups = { producers: new Map(), consumers: new Map() };
for (const f of fibers) {
  const c = classifies(f.type);
  const name = getDisplayName(f) || '<anonymous>';
  if (nameRe && !nameRe.test(name)) continue;
  if (c.isProducer && (kind === 'producer' || kind === 'both')) {
    let rec = groups.producers.get(name);
    if (!rec) { rec = { name, count: 0, contextKeys: Object.keys(f.type.childContextTypes), samples: [] }; groups.producers.set(name, rec); }
    rec.count++;
    if (rec.samples.length < 3) rec.samples.push({ self: fiberInfo(f), owner: f._debugOwner ? fiberInfo(f._debugOwner) : null });
  }
  if (c.isConsumer && (kind === 'consumer' || kind === 'both')) {
    let rec = groups.consumers.get(name);
    if (!rec) { rec = { name, count: 0, contextKeys: Object.keys(f.type.contextTypes), samples: [] }; groups.consumers.set(name, rec); }
    rec.count++;
    if (rec.samples.length < 3) rec.samples.push({ self: fiberInfo(f), owner: f._debugOwner ? fiberInfo(f._debugOwner) : null });
  }
}

const sortRows = (m) => Array.from(m.values()).sort((a, b) => b.count - a.count).slice(0, max);
return {
  scannedFibers: fibers.length,
  producers: sortRows(groups.producers),
  consumers: sortRows(groups.consumers),
};
