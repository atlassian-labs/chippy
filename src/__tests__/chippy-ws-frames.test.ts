import { describe, expect, it } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { createWsFrameReader, wsFrameLength } = require('../../.agents/skills/chippy/scripts/ws-frames.js');

// A masked client frame, as a browser sends it.
function frame(text: string, { opcode = 0x1, fin = true } = {}) {
  const payload = Buffer.from(text);
  const mask = Buffer.from([1, 2, 3, 4]);
  const length = payload.length;
  const header = length < 126 ? Buffer.from([0, 0x80 | length])
    : length < 65536 ? Buffer.alloc(4) : Buffer.alloc(10);
  if (length >= 126 && length < 65536) { header[1] = 0x80 | 126; header.writeUInt16BE(length, 2); }
  if (length >= 65536) { header[1] = 0x80 | 127; header.writeBigUInt64BE(BigInt(length), 2); }
  header[0] = (fin ? 0x80 : 0) | opcode;
  const body = Buffer.from(payload.map((byte, i) => byte ^ mask[i % 4]));
  return Buffer.concat([header, mask, body]);
}

const texts = (messages: Array<{ payload: Buffer }>) => messages.map((m) => m.payload.toString());

describe('helper WebSocket frame reader', () => {
  it('returns a large message once all its chunks arrive', () => {
    const text = 'x'.repeat(3_000_000);
    const bytes = frame(text);
    expect(wsFrameLength(bytes)).toBe(bytes.length);
    const read = createWsFrameReader();
    const out: string[] = [];
    for (let i = 0; i < bytes.length; i += 65536) out.push(...texts(read(bytes.subarray(i, i + 65536))));
    expect(out).toEqual([text]);
  });

  it('unmasks payloads of every length and alignment', () => {
    const read = createWsFrameReader();
    for (const length of [1, 3, 15, 16, 17, 18, 19, 1001, 4099, 70_003]) {
      const text = Array.from({ length }, (_, i) => String.fromCharCode(33 + ((i * 7) % 90))).join('');
      expect(texts(read(frame(text)))).toEqual([text]);
    }
  });

  it('reads several frames from one chunk and a header split across chunks', () => {
    const read = createWsFrameReader();
    const bytes = Buffer.concat([frame('one'), frame('two'), frame('y'.repeat(300))]);
    const split = bytes.length - 300 - 4 - 3; // inside the third frame's header
    expect(texts(read(bytes.subarray(0, split)))).toEqual(['one', 'two']);
    expect(texts(read(bytes.subarray(split)))).toEqual(['y'.repeat(300)]);
  });

  it('joins fragmented messages and passes control frames through', () => {
    const read = createWsFrameReader();
    const messages = read(Buffer.concat([
      frame('hel', { fin: false }),
      frame('', { opcode: 0x9 }),
      frame('lo', { opcode: 0x0 }),
    ]));
    expect(messages.map((m: { opcode: number }) => m.opcode)).toEqual([0x9, 0x1]);
    expect(messages[1].payload.toString()).toBe('hello');
  });
});
