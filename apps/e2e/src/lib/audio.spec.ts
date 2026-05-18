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
