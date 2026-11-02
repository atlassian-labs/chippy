/* eslint-disable */
// Extracted from chippy-helper-server.js so tests can import it.
// Single responsibility: translate POST body fields into a bridge command.
// Every new forwarded field must have a corresponding test in
// src/chippy-bridge/wire-forwarding.test.ts.

function buildAvalancheCommand(body = {}, requestId = 'test-request-id') {
  const command = {
    type: 'eval-avalanche',
    requestId,
    action: String(body.action || 'status'),
  };
  if (body.options && typeof body.options === 'object') command.options = body.options;

  // Legacy fields (start.max, export-last.count) — kept for backward compat
  // with older callers; new bridge ignores them in favour of upstream-shape
  // arguments. Will be removed once external callers migrate.
  if (body.max != null) command.max = Number(body.max);
  if (body.count != null) command.count = Number(body.count);
  if (body.limit != null) command.limit = Number(body.limit);
  if (body.commitId != null) command.commitId = Number(body.commitId);
  if (body.top != null) command.top = Number(body.top);
  if (body.by != null) command.by = String(body.by);
  if (body.depth != null) command.depth = Number(body.depth);
  if (body.maxItems != null) command.maxItems = Number(body.maxItems);
  if (body.sourceId != null) command.sourceId = String(body.sourceId);
  if (body.hookIndex != null) command.hookIndex = Number(body.hookIndex);
  if (body.window != null) command.window = Number(body.window);
  if (body.actionId != null) command.actionId = Number(body.actionId);
  if (Array.isArray(body.include)) command.include = body.include.map(String);
  return command;
}

module.exports = { buildAvalancheCommand };
