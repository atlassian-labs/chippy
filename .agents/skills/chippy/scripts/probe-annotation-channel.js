/* eslint-disable */

const DIRECT_PROBE_IDS = new Set(['1', '2']);

function normalizedAnnotation(marker) {
  return {
    intent: marker?.intent ?? null,
    comment: typeof marker?.comment === 'string' ? marker.comment : '',
  };
}

function annotationChanged(previousMarker, nextMarker) {
  const previous = normalizedAnnotation(previousMarker);
  const next = normalizedAnnotation(nextMarker);
  return previous.intent !== next.intent || previous.comment !== next.comment;
}

function createProbeAnnotationChannel({ maxEvents = 200, serializeMarker = (marker) => marker } = {}) {
  // Each client keeps a bounded, non-destructive event log. Readers pass a
  // cursor (the last sequence they handled) and get the first newer event, so
  // re-arming a wait, a lost response, or a second reader never drops an event.
  const logs = new Map(); // clientId → { events, droppedThrough, implicitCursor }
  const waiters = new Map(); // clientId → Set<waiter>
  let sequence = 0;

  function getLog(clientId) {
    if (!logs.has(clientId)) logs.set(clientId, { events: [], droppedThrough: 0, implicitCursor: 0 });
    return logs.get(clientId);
  }

  function read(clientId, after) {
    const log = getLog(clientId);
    const event = log.events.find((entry) => entry.sequence > after) || null;
    return {
      event,
      cursor: event ? event.sequence : Math.max(after, log.events.at(-1)?.sequence ?? after),
      // Events newer than the cursor were evicted before anyone read them.
      missed: after < log.droppedThrough,
      droppedThrough: log.droppedThrough || null,
    };
  }

  function deliver(clientId, event) {
    const log = getLog(clientId);
    log.events.push(event);
    while (log.events.length > maxEvents) log.droppedThrough = log.events.shift().sequence;
    for (const waiter of [...(waiters.get(clientId) || [])]) {
      if (event.sequence > waiter.after) waiter.finish(read(clientId, waiter.after));
    }
  }

  function publish({ clientId, at, page, integration, previousSnapshot, snapshot }) {
    const previousMarkers = previousSnapshot?.markers || {};
    const nextMarkers = snapshot?.markers || {};
    const directIds = Object.keys(nextMarkers).filter((id) => DIRECT_PROBE_IDS.has(id));
    const changedProbeIds = directIds.filter((id) => annotationChanged(previousMarkers[id], nextMarkers[id]));
    const annotatedProbeIds = directIds.filter((id) => {
      const annotation = normalizedAnnotation(nextMarkers[id]);
      return annotation.intent !== null || annotation.comment.length > 0;
    });
    const selectedProbeIds = changedProbeIds.length
      ? changedProbeIds
      : (annotatedProbeIds.length ? annotatedProbeIds : directIds);

    const event = {
      eventId: `probe-annotation:${++sequence}`,
      sequence,
      at,
      clientId,
      reason: 'marker-annotation-change',
      page: page || null,
      integration: integration || null,
      changedProbeIds,
      annotations: selectedProbeIds.map((probeId) => ({
        probeId,
        ...normalizedAnnotation(nextMarkers[probeId]),
        marker: serializeMarker(nextMarkers[probeId]),
      })),
    };
    deliver(clientId, event);
    return event;
  }

  // `after` is the caller's cursor. Without one, the channel keeps an implicit
  // per-client cursor that moves only when the caller calls `consume()` after
  // the event has actually reached it.
  /** @param {string} clientId @param {number} timeoutMs @param {{ after?: number }} [options] */
  function wait(clientId, timeoutMs, { after } = {}) {
    const log = getLog(clientId);
    const explicit = Number.isInteger(after) && after >= 0;
    const cursor = explicit ? after : log.implicitCursor;
    const consume = (result) => {
      if (!explicit && result?.event) log.implicitCursor = Math.max(log.implicitCursor, result.event.sequence);
    };

    const ready = read(clientId, cursor);
    if (ready.event) return { promise: Promise.resolve(ready), cancel() {}, consume, after: cursor };

    let waiter;
    const promise = new Promise((resolve) => {
      waiter = {
        after: cursor,
        settled: false,
        timer: null,
        finish(result) {
          if (this.settled) return;
          this.settled = true;
          clearTimeout(this.timer);
          const waiting = waiters.get(clientId);
          waiting?.delete(this);
          if (waiting?.size === 0) waiters.delete(clientId);
          resolve(result);
        },
      };
      waiter.timer = setTimeout(() => waiter.finish(read(clientId, cursor)), timeoutMs);
      if (!waiters.has(clientId)) waiters.set(clientId, new Set());
      waiters.get(clientId).add(waiter);
    });

    return {
      promise,
      cancel() {
        if (!waiter || waiter.settled) return;
        waiter.finish(null);
      },
      consume,
      after: cursor,
    };
  }

  // Marks an event handled. Returns the retained event, or null when it was
  // never published for this client or has been evicted.
  function acknowledge(clientId, eventSequence) {
    const event = getLog(clientId).events.find((entry) => entry.sequence === eventSequence) || null;
    if (event && !event.acknowledgedAt) event.acknowledgedAt = new Date().toISOString();
    return event;
  }

  return { publish, wait, acknowledge };
}

module.exports = { createProbeAnnotationChannel };
