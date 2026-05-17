import { describe, it, expect, vi } from 'vitest';

const dbSelectMock = vi.fn();
vi.mock('../src/lib/db.js', () => ({
  getDb: () => ({ select: dbSelectMock }),
  schema: {
    call: { _: 'call' },
    recording: { _: 'recording' },
    // dispatchAttempt has no callId/tenantId columns — excluded from assertTenant
    queueCall: { _: 'queue_call' },
  },
}));

import { assertTenant } from '../src/lib/assert-tenant.js';

describe('assertTenant', () => {
  it('queries each per-tenant table for the seeded tenantId', async () => {
    dbSelectMock.mockReturnValue({
      from: () => ({ where: () => Promise.resolve([{ tenantId: 't1' }]) }),
    });
    await assertTenant('t1', 'call-uuid');
    // 3 tables: call (by id), recording (by callId), queueCall (by callId)
    expect(dbSelectMock).toHaveBeenCalledTimes(3);
  });
});
