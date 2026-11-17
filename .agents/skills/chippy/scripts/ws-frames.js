// Server-side WebSocket frame reading (RFC 6455) for the helper.
'use strict';

// Bytes needed for the first complete frame in `buffer`, or 0 when its header
// is incomplete.
function wsFrameLength(buffer) {
  if (buffer.length < 2) return 0;
  const b1 = buffer[1];
  const mLen = (b1 & 0x80) !== 0 ? 4 : 0;
  let pLen = b1 & 0x7f, hLen = 2;
  if (pLen === 126) {
    if (buffer.length < 4) return 0;
    pLen = buffer.readUInt16BE(2); hLen = 4;
  } else if (pLen === 127) {
    if (buffer.length < 10) return 0;
    pLen = Number(buffer.readBigUInt64BE(2)); hLen = 10;
  }
  return hLen + mLen + pLen;
}

// Collects socket chunks and joins them only when a whole frame has arrived;
// joining on every chunk copied a large message once per chunk.
function createWsFrameReader(frag = {}) {
  let chunks = [];
  let length = 0;
  let need = 0;
  return function read(chunk) {
    chunks.push(chunk);
    length += chunk.length;
    if (length < need) return [];
    const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks, length);
    const { messages, remainder } = wsParseFrames(buffer, frag);
    chunks = remainder.length ? [remainder] : [];
    length = remainder.length;
    need = wsFrameLength(remainder);
    return messages;
  };
}

function wsParseFrames(buffer, frag = {}) {
  const messages = [];
  let off = 0;
  while (off + 2 <= buffer.length) {
    const b0 = buffer[off], b1 = buffer[off + 1];
    const fin = (b0 & 0x80) !== 0;
    const opcode = b0 & 0x0f;
    const masked = (b1 & 0x80) !== 0;
    let pLen = b1 & 0x7f, hLen = 2;
    if (pLen === 126) {
      if (off + 4 > buffer.length) break;
      pLen = buffer.readUInt16BE(off + 2); hLen = 4;
    } else if (pLen === 127) {
      if (off + 10 > buffer.length) break;
      pLen = Number(buffer.readBigUInt64BE(off + 2)); hLen = 10;
    }
    const mLen = masked ? 4 : 0;
    const total = hLen + mLen + pLen;
    if (off + total > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(off + hLen + mLen, off + hLen + mLen + pLen));
    if (masked) {
      const mask = buffer.subarray(off + hLen, off + hLen + 4);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
    }
    off += total;

    // Control frames (close/ping/pong) pass through directly
    if (opcode === 0x8 || opcode === 0x9 || opcode === 0xA) {
      messages.push({ opcode, payload });
      continue;
    }
    // Data frame: start new or continue fragment
    if (opcode !== 0) { frag.opcode = opcode; frag.chunks = [payload]; }
    else if (frag.chunks) { frag.chunks.push(payload); }

    if (fin && frag.chunks) {
      const full = frag.chunks.length === 1 ? frag.chunks[0] : Buffer.concat(frag.chunks);
      messages.push({ opcode: frag.opcode, payload: full });
      frag.chunks = null; frag.opcode = null;
    }
  }
  return { messages, remainder: buffer.subarray(off) };
}

module.exports = { createWsFrameReader, wsFrameLength, wsParseFrames };
