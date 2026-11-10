'use strict';

// Confirms how connected page clients nest in frames. Each bridge reports its
// own view (page.frame): the child the parent client id it was answered by,
// the parent the child client ids that announced themselves. A link counts
// only when both sides report it and the parent's page origin matches the
// origin the child saw, so one page alone cannot attach itself to another.

const MAX_DEPTH = 16;

function originOf(url) {
  try {
    const origin = new URL(url).origin;
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}

function reportedFrame(client) {
  const frame = client?.page?.frame;
  return frame && typeof frame === 'object' ? frame : null;
}

/**
 * @param {object} child
 * @param {Map<string, object>} clients
 * @returns {object | null} the confirmed parent client
 */
function confirmedParent(child, clients) {
  const frame = reportedFrame(child);
  const parentId = frame?.parentClientId;
  if (!parentId || parentId === child.clientId) return null;
  const parent = clients.get(parentId);
  const parentFrame = reportedFrame(parent);
  if (!parentFrame || !Array.isArray(parentFrame.childClientIds)) return null;
  if (!parentFrame.childClientIds.includes(child.clientId)) return null;
  const parentOrigin = originOf(parent.page?.url);
  if (!parentOrigin || parentOrigin !== frame.parentOrigin) return null;
  return parent;
}

/**
 * The frame position of one client, with links confirmed against the other
 * connected clients. Returns null when the bridge reported no frame data.
 *
 * @param {object} client
 * @param {Map<string, object>} clients connected clients by client id
 */
function describeClientFrame(client, clients) {
  const frame = reportedFrame(client);
  if (!frame) return null;
  const parent = confirmedParent(client, clients);
  let topClientId = null;
  if (frame.isTop) {
    topClientId = client.clientId;
  } else {
    // The top client is known only when every link up to it is confirmed.
    let current = client;
    for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
      const up = confirmedParent(current, clients);
      if (!up) break;
      current = up;
      if (reportedFrame(current)?.isTop) { topClientId = current.clientId; break; }
    }
  }
  const childClientIds = [];
  for (const other of clients.values()) {
    if (other !== client && confirmedParent(other, clients) === client) childClientIds.push(other.clientId);
  }
  const claimedParent = typeof frame.parentClientId === 'string' ? frame.parentClientId : null;
  return {
    isTop: Boolean(frame.isTop),
    path: Array.isArray(frame.path) ? frame.path : null,
    ancestorOrigins: Array.isArray(frame.ancestorOrigins) ? frame.ancestorOrigins : [],
    parentClientId: parent ? parent.clientId : null,
    parentOrigin: typeof frame.parentOrigin === 'string' ? frame.parentOrigin : null,
    // A parent the child named that is gone, or that has not confirmed it.
    unconfirmedParentClientId: claimedParent && !parent ? claimedParent : null,
    topClientId,
    childClientIds,
    // A child frame shows its panel only after the agent's `activate`.
    panelRemembered: Boolean(frame.panelRemembered),
  };
}

module.exports = { describeClientFrame };
