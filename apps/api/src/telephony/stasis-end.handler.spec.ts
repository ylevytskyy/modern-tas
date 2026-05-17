import { describe, it, expect } from 'vitest';
import { deriveEndedBy } from './stasis-end.handler';

describe('deriveEndedBy', () => {
  // Asterisk Q.850 hangup-cause codes:
  // 16 = Normal Clearing, 17 = User Busy, 19 = No Answer, 21 = Call Rejected
  // 32 = No circuit (PJSIP TCP close without BYE), 34 = No circuit available (same)

  it.each([16, 17, 19, 21, 32, 34])(
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

  it('returns "caller" when cause is undefined on inbound leg (PoC: caller disconnected)', () => {
    expect(deriveEndedBy(undefined, true)).toBe('caller');
  });

  it('returns "system" when cause is undefined on outbound leg', () => {
    expect(deriveEndedBy(undefined, false)).toBe('system');
  });
});
