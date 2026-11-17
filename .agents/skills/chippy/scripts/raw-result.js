// Large Avalanche results pass through the helper as bytes.
//
// Parsing a full export only to serialize it again for the HTTP reply cost the
// helper more time than the page spent producing it. When the helper says so
// in its `connected` message (`rawResults: true`), the page bridge may send a
// large result as one line of header JSON, a newline, then the result JSON:
//
//   {"type":"eval-avalanche-result","clientId":"c1","requestId":"r1","rawResult":true}\n{...result...}
//
// JSON.stringify never writes a raw newline, so ordinary messages cannot be
// mistaken for this form. The reply puts the page's bytes first and the
// helper's own fields after them: in valid JSON the later duplicate key wins,
// so a page cannot overwrite `targetClientId` or `ok`, and bytes that try to
// absorb the helper's fields leave the reply invalid instead.
'use strict';

const NEWLINE = 0x0a;
const RAW_RESULT_TYPES = new Set(['eval-avalanche-result']);

class RawJson {
  constructor(bytes) {
    this.bytes = bytes;
  }
}

/**
 * The message in `payload` when it uses the raw form, with `result` as
 * RawJson; null for an ordinary JSON message. Throws for a raw header the
 * helper does not accept.
 */
function readRawResultMessage(payload) {
  const end = payload.indexOf(NEWLINE);
  if (end <= 0) return null;
  let header;
  try {
    header = JSON.parse(payload.toString('utf8', 0, end));
  } catch {
    return null;
  }
  if (!header || typeof header !== 'object' || header.rawResult !== true) return null;
  if (!RAW_RESULT_TYPES.has(header.type) || !header.requestId) {
    throw new Error(`raw results are accepted only for ${[...RAW_RESULT_TYPES].join(', ')} with a requestId`);
  }
  const { rawResult, ...message } = header;
  message.result = new RawJson(payload.subarray(end + 1));
  return message;
}

/** The reply bytes when `payload.result` is RawJson; otherwise null. */
function serializeWithRawResult(payload) {
  if (!payload || !(payload.result instanceof RawJson)) return null;
  const { result, ...fields } = payload;
  const rest = JSON.stringify(fields);
  return Buffer.concat([
    Buffer.from('{"result":'),
    result.bytes,
    Buffer.from(rest === '{}' ? '}' : `,${rest.slice(1)}`),
  ]);
}

module.exports = { RawJson, readRawResultMessage, serializeWithRawResult };
