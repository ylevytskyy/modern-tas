import { describe, it, expect } from 'vitest';
import { deriveEndedBy } from './stasis-end.handler';

describe('deriveEndedBy', () => {
  // Asterisk Q.850 hangup-cause codes:
  // 16 = Normal Clearing, 17 = User Busy, 19 = No Answer, 21 = Call Rejected

  it.each([16, 17, 19, 21])(
    'returns "caller" for caller-initiated cause %i on inbound leg',
    (cause) => {
      expect(deriveEndedBy(cause, /* isInbound */ true)).toBe('caller');
    },
  );

  it.each([16, 17, 19, 21])(
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
