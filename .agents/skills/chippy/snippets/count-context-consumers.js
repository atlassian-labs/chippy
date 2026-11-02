// Count modern Context consumers for a given Context displayName regex.
// A consumer is any fiber whose dependencies list contains the matching context.
// Args:
//   --name <regex>   REQUIRED. Context displayName regex (case-insensitive).
//   --max  <N>       cap consumer samples returned (default 100)

const { walkAll, fiberInfo } = ctx.helpers;
if (!ctx.args.name) return { error: '--name <regex> is required' };
const nameRe = new RegExp(String(ctx.args.name), 'i');
const max = Number(ctx.args.max) || 100;

const consumers = [];
let scanned = 0;
let totalConsumers = 0;
walkAll((f) => {
  scanned++;
  // dependencies.firstContext is a singly-linked list of ContextDependency
  const dep = f?.dependencies;
  if (!dep) return;
  let cur = dep.firstContext;
  while (cur) {
    const c = cur.context;
    const name = c?.displayName || c?._context?.displayName || null;
    if (name && nameRe.test(name)) {
      totalConsumers++;
      if (consumers.length < max) {
        consumers.push({
          contextName: name,
          consumer: fiberInfo(f),
          owner: f._debugOwner ? fiberInfo(f._debugOwner) : null,
        });
      }
      break;
    }
    cur = cur.next;
  }
});

ctx.log.push('scanned fibers: ' + scanned);
return { matchedContexts: nameRe.source, totalConsumers, sampleCount: consumers.length, consumers };
