import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDeliverViaWs } from './deliver-via-ws';

describe('deliverViaWs', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('POSTs to /internal/dispatch-deliver with the X-Internal-Token header', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ delivered: true }),
    });
    const activity = makeDeliverViaWs({
      apiBaseUrl: 'http://api.test',
      internalToken: 'secret-123',
      fetch: fetchMock as unknown as typeof fetch,
    });

    const result = await activity({
      messageId: 'm-1',
      operatorId: 'op-1',
      payload: { body: 'hi' },
    });

    expect(result).toEqual({ delivered: true });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/internal/dispatch-deliver');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['X-Internal-Token']).toBe('secret-123');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      messageId: 'm-1',
      operatorId: 'op-1',
      payload: { body: 'hi' },
    });
  });

  it('throws when the api returns non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 502 });
    const activity = makeDeliverViaWs({
      apiBaseUrl: 'http://api.test',
      internalToken: 'secret-123',
      fetch: fetchMock as unknown as typeof fetch,
    });
    await expect(activity({
      messageId: 'm-1', operatorId: 'op-1', payload: {},
    })).rejects.toThrow(/502/);
  });
});
