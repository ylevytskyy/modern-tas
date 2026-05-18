import { describe, it, expect } from 'vitest';
import { deriveEndedBy } from './stasis-end.handler';

describe('deriveEndedBy', () => {
  // Asterisk Q.850 hangup-cause codes:
  // 16 = Normal Clearing (SIP CANCEL with Reason: Q.850 ;cause=16)
  // 17 = User Busy, 19 = No Answer, 21 = Call Rejected
  // 32 = PoC-scoped: Asterisk emits this on ARI DELETE (local-dev e2e fallback path).
  //      Reverts to {16,17,19,21} post-Chunk 7 when a real carrier trunk is added.

  it.each([16, 17, 19, 21, 32])(
    'returns "caller" for caller-initiated cause %i on inbound leg',
    (cause) => {
      expect(deriveEndedBy(cause, /* isInbound */ true)).toBe('caller');
    },
  );

  it.each([16, 17, 19, 21, 32])(
    'returns "operator" for operator-initiated cause %i on outbound leg',
    (cause) => {
      expect(deriveEndedBy(cause, /* isInbound */ false)).toBe('operator');
    },
  );

  it('returns "system" for non-normal causes (e.g. 41 Temporary Failure)', () => {
    expect(deriveEndedBy(41, true)).toBe('system');
    expect(deriveEndedBy(41, false)).toBe('system');
  });

  it('returns "system" when cause is undefined', () => {
    expect(deriveEndedBy(undefined as unknown as number, true)).toBe('system');
    expect(deriveEndedBy(undefined as unknown as number, false)).toBe('system');
  });
});
