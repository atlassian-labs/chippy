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

function createProbeAnnotationChannel({ maxEvents = 50, serializeMarker = (marker) => marker } = {}) {
  const queues = new Map();
  const waiters = new Map();
  let sequence = 0;

  function getQueue(clientId) {
    if (!queues.has(clientId)) queues.set(clientId, []);
    return queues.get(clientId);
  }

  function getWaiters(clientId) {
    if (!waiters.has(clientId)) waiters.set(clientId, []);
    return waiters.get(clientId);
  }

  function deliver(clientId, event) {
    const waiting = getWaiters(clientId);
    while (waiting.length) {
      const waiter = waiting.shift();
      if (waiter.settled) continue;
      waiter.finish(event);
      return;
    }
    const queue = getQueue(clientId);
    queue.push(event);
    while (queue.length > maxEvents) queue.shift();
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

  function wait(clientId, timeoutMs) {
    const queue = getQueue(clientId);
    if (queue.length) {
      return { promise: Promise.resolve(queue.shift()), cancel() {} };
    }

    let waiter;
    const promise = new Promise((resolve) => {
      waiter = {
        settled: false,
        timer: null,
        finish(event) {
          if (this.settled) return;
          this.settled = true;
          clearTimeout(this.timer);
          const waiting = waiters.get(clientId);
          const index = waiting?.indexOf(this) ?? -1;
          if (index >= 0) waiting.splice(index, 1);
          if (waiting?.length === 0) waiters.delete(clientId);
          resolve(event);
        },
      };
      waiter.timer = setTimeout(() => waiter.finish(null), timeoutMs);
      getWaiters(clientId).push(waiter);
    });

    return {
      promise,
      cancel() {
        if (!waiter || waiter.settled) return;
        waiter.finish(null);
      },
    };
  }

  return { publish, wait };
}

module.exports = { createProbeAnnotationChannel };
