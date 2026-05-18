import { describe, it, expect } from 'vitest';
import { Buffer } from 'node:buffer';
import { assertWavDurationDelta, parseWavDurationMs } from './audio.js';

/**
 * Build a minimal valid PCM WAV header. Pure header, no audio data —
 * dataSize indicates how many bytes of audio "follow" (the parser uses
 * the chunk size, not the actual buffer length, to compute duration).
 */
function makeWavHeader(opts: {
  sampleRate: number;
  bitsPerSample: number;
  numChannels: number;
  dataSize: number;
}): Buffer {
  const { sampleRate, bitsPerSample, numChannels, dataSize } = opts;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const buf = Buffer.alloc(44);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

describe('parseWavDurationMs', () => {
  it('computes duration for 8 kHz / 16-bit / mono', () => {
    const buf = makeWavHeader({ sampleRate: 8000, bitsPerSample: 16, numChannels: 1, dataSize: 8000 });
    expect(parseWavDurationMs(buf)).toBe(500);
  });

  it('computes duration for 8 kHz / 8-bit / mono', () => {
    const buf = makeWavHeader({ sampleRate: 8000, bitsPerSample: 8, numChannels: 1, dataSize: 16000 });
    expect(parseWavDurationMs(buf)).toBe(2000);
  });

  it('returns 0 for an empty data chunk', () => {
    const buf = makeWavHeader({ sampleRate: 8000, bitsPerSample: 16, numChannels: 1, dataSize: 0 });
    expect(parseWavDurationMs(buf)).toBe(0);
  });

  it('throws on a non-RIFF buffer', () => {
    expect(() => parseWavDurationMs(Buffer.from('not-a-wav-at-all-12345'))).toThrow(/RIFF/i);
  });

  // I6 — Bug fix: truncated fmt chunk must throw a library Error, not a Node RangeError.
  // The buffer must be ≥44 bytes (to pass the existing early guard) but the fmt chunk
  // payload must be truncated such that byteRate (at offset+16 relative to fmt start)
  // falls outside the buffer. We achieve this by placing a JUNK chunk first to push
  // the fmt chunk near the end of the buffer.
  it('throws WAV parse error (not RangeError) when fmt chunk payload is truncated', () => {
    // Layout: RIFF(12) + JUNK(8+36=44) + fmt header(8) + 4 bytes payload = 68 bytes total.
    // fmt chunk claims 16 bytes payload but only 4 are present; byteRate read at
    // fmtStart+16 = 64+16 = 80 which is beyond the 68-byte buffer → RangeError without fix.
    const junkPayload = 36;
    const fmtOffset = 12 + 8 + junkPayload; // 56
    const totalLen = fmtOffset + 8 + 4;     // 68: fmt header + 4 bytes payload only
    const buf = Buffer.alloc(totalLen);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(totalLen - 8, 4);
    buf.write('WAVE', 8);
    buf.write('JUNK', 12);
    buf.writeUInt32LE(junkPayload, 16);      // JUNK payload = 36 bytes (all zeros)
    buf.write('fmt ', fmtOffset);
    buf.writeUInt32LE(16, fmtOffset + 4);   // claims 16 bytes of fmt payload...
    buf.writeUInt16LE(1, fmtOffset + 8);    // audioFormat: PCM
    buf.writeUInt16LE(1, fmtOffset + 10);   // numChannels
    // sampleRate/byteRate fields are MISSING (buffer ends here) — only 4 bytes written
    const err = (() => { try { parseWavDurationMs(buf); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).constructor.name).toBe('Error');  // not RangeError
    expect((err as Error).message).toMatch(/WAV parse:/);
  });

  // I6 — Nit: RF64/streaming sentinel 0xFFFFFFFF must throw, not silently produce ~3.1B ms
  it('throws on RF64/streaming WAV (data size 0xFFFFFFFF)', () => {
    const buf = makeWavHeader({ sampleRate: 8000, bitsPerSample: 16, numChannels: 1, dataSize: 0 });
    // Overwrite the data chunk size field with the RF64 sentinel
    buf.writeUInt32LE(0xFFFFFFFF, 40);
    expect(() => parseWavDurationMs(buf)).toThrow(/WAV parse:.*RF64|WAV parse:.*streaming/i);
  });

  // Regression guard: JUNK chunk before fmt must be walked past correctly
  it('correctly walks past a JUNK chunk before fmt ', () => {
    // Build: RIFF (12) + JUNK chunk (8 + 4 = 12) + standard fmt+data (32 bytes) = 56 bytes
    const junkPayload = 4;
    const totalSize = 12 + (8 + junkPayload) + 32; // 56
    const buf = Buffer.alloc(totalSize);
    buf.write('RIFF', 0);
    buf.writeUInt32LE(totalSize - 8, 4);
    buf.write('WAVE', 8);
    // JUNK chunk
    buf.write('JUNK', 12);
    buf.writeUInt32LE(junkPayload, 16);
    // (4 bytes of junk payload, all zeros)
    const fmtOffset = 12 + 8 + junkPayload; // 24
    const sampleRate = 8000;
    const byteRate = 8000 * 1 * 2;
    buf.write('fmt ', fmtOffset);
    buf.writeUInt32LE(16, fmtOffset + 4);
    buf.writeUInt16LE(1, fmtOffset + 8);   // audioFormat PCM
    buf.writeUInt16LE(1, fmtOffset + 10);  // numChannels
    buf.writeUInt32LE(sampleRate, fmtOffset + 12);
    buf.writeUInt32LE(byteRate, fmtOffset + 16);
    buf.writeUInt16LE(2, fmtOffset + 20);  // blockAlign
    buf.writeUInt16LE(16, fmtOffset + 22); // bitsPerSample
    const dataOffset = fmtOffset + 8 + 16; // 48
    buf.write('data', dataOffset);
    buf.writeUInt32LE(16000, dataOffset + 4); // 1s of audio at byteRate=16000
    expect(parseWavDurationMs(buf)).toBe(1000);
  });
});

describe('assertWavDurationDelta', () => {
  const buf500ms = makeWavHeader({ sampleRate: 8000, bitsPerSample: 16, numChannels: 1, dataSize: 8000 });

  it('passes when actual ≈ expected within tolerance', () => {
    expect(() => assertWavDurationDelta(buf500ms, 500, 50)).not.toThrow();
    expect(() => assertWavDurationDelta(buf500ms, 480, 50)).not.toThrow();
    expect(() => assertWavDurationDelta(buf500ms, 520, 50)).not.toThrow();
  });

  it('throws when actual is outside tolerance', () => {
    expect(() => assertWavDurationDelta(buf500ms, 400, 50)).toThrow(/duration/i);
    expect(() => assertWavDurationDelta(buf500ms, 600, 50)).toThrow(/duration/i);
  });

  it('defaults toleranceMs to 50', () => {
    expect(() => assertWavDurationDelta(buf500ms, 549)).not.toThrow();
    expect(() => assertWavDurationDelta(buf500ms, 551)).toThrow();
  });
});
