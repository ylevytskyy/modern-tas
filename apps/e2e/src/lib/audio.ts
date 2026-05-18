import { Buffer } from 'node:buffer';

/**
 * Parse a WAV header and return the audio duration in milliseconds.
 *
 * Walks RIFF chunks starting from offset 12 to find `fmt ` (for the byte rate)
 * and `data` (for the byte count). Duration = data size / byte rate. Works for
 * PCM 16-bit/8 kHz/mono (the format Asterisk Channel.record writes for
 * uncompressed wav) and the 8-bit µ-law variant.
 */
export function parseWavDurationMs(buf: Buffer): number {
  if (buf.length < 4 || buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('WAV parse: not a RIFF buffer');
  if (buf.length < 44) throw new Error('WAV parse: buffer too small');
  if (buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('WAV parse: not a WAVE file');

  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= buf.length) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      // fmt fields: audioFormat (offset+8), numChannels (+10), sampleRate (+12), byteRate (+16),
      // blockAlign (+20), bitsPerSample (+22). The +16 byteRate is what duration calc needs.
      byteRate = buf.readUInt32LE(offset + 16);
    } else if (chunkId === 'data') {
      dataSize = chunkSize;
      break;
    }
    // Chunks are word-aligned: pad size up to even number of bytes.
    offset += 8 + chunkSize + (chunkSize % 2);
  }

  if (byteRate === 0) throw new Error('WAV parse: byteRate is zero or fmt chunk missing');
  return Math.round((dataSize / byteRate) * 1000);
}

/**
 * Asserts the WAV's audio duration is within ±toleranceMs of the expected duration.
 *
 * Used by the S-2 e2e spec to verify that recording_redaction_interval rows agree
 * with the actual WAV produced by Asterisk: wavDurationMs ≈ callDurationMs −
 * Σ(intervalEndMs − intervalStartMs) ± toleranceMs.
 */
export function assertWavDurationDelta(
  wavBytes: Buffer,
  expectedDurationMs: number,
  toleranceMs: number = 50,
): void {
  const actual = parseWavDurationMs(wavBytes);
  const delta = Math.abs(actual - expectedDurationMs);
  if (delta > toleranceMs) {
    throw new Error(
      `WAV duration delta: actual=${actual}ms expected=${expectedDurationMs}ms ` +
      `delta=${delta}ms tolerance=${toleranceMs}ms`,
    );
  }
}
