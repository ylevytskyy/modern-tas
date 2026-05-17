import { describe, it, expect, vi } from 'vitest';
import { postMessage } from './api';

describe('postMessage', () => {
  it('POSTs to /v1/Message with Bearer JWT', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'm-1', createdAt: '2026-05-16T00:00:00.000Z' }),
    });
    const result = await postMessage({
      apiBaseUrl: 'http://api.test',
      token: 'jwt-abc',
      body: { callId: 'c-1', accountId: 'a-1', operatorId: 'op-1', body: 'hello' },
      fetch: fetchMock as unknown as typeof fetch,
    });
    expect(result.id).toBe('m-1');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://api.test/v1/Message');
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer jwt-abc');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('throws on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 401 });
    await expect(postMessage({
      apiBaseUrl: 'http://api.test',
      token: 'bad',
      body: { callId: 'c', accountId: 'a', operatorId: 'op', body: 'hi' },
      fetch: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow(/401/);
  });
});
