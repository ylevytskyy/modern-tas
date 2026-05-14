// RED: fails because packages/ari-client/src/leader.ts does not exist yet.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * AriLeaderClient hard-stop callback test.
 *
 * Verifies the CALLBACK PATH: that onLoseLease() is called and the WS is closed
 * when the lease is lost. Does NOT assert timing precision with fake timers
 * (Date.now() is frozen by vi.useFakeTimers — latency would always be 0ms, trivially passing).
 *
 * Real wire-level FIN < 100ms evidence (ADR-0016 §Decision item 3) is produced
 * in Chunk 7 S-5 spec running two real NestJS instances against real Redis + tcpdump.
 */
describe('AriLeaderClient — hard-stop callback path (mock Redis/ARI, no real infrastructure)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['nextTick', 'setTimeout', 'setInterval', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('calls onLoseLease and closes WS when lease is lost on heartbeat', async () => {
    const { AriLeaderClient } = await import('../src/leader.js');

    // Mock ioredis: first SET NX returns 'OK' (acquire), then GET returns 'other-instance' (lost lease)
    const mockRedisGet = vi.fn()
      .mockResolvedValueOnce('test-leader')   // first renew: GET returns own ID (still held)
      .mockResolvedValueOnce('other-instance'); // second renew: GET returns foreign ID (lost)
    const mockRedisSet = vi.fn().mockResolvedValue('OK');
    const mockRedisPexpire = vi.fn().mockResolvedValue(1);
    const mockRedis = {
      get: mockRedisGet,
      set: mockRedisSet,
      pexpire: mockRedisPexpire,
    };

    const mockWsClose = vi.fn();
    const mockAriClient = {
      _connection: { ws: { close: mockWsClose } },
      stop: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      on: vi.fn(),
    };

    const onLoseLease = vi.fn();

    const leader = new AriLeaderClient({
      instanceId: 'test-leader',
      leaseKey: 'test:ari-leader',
      ttlMs: 1500,
      heartbeatMs: 500,
      redis: mockRedis as any,
      ariClientFactory: async () => mockAriClient as any,
      onStasisStart: vi.fn(),
      onLoseLease,
    });

    // Heartbeat 1: tryAcquire → SET NX returns OK → become leader
    await leader._heartbeatOnce();
    expect(leader.isLeaderForTest).toBe(true);

    // Heartbeat 2: renew → GET returns own ID → still leader
    await leader._heartbeatOnce();
    expect(leader.isLeaderForTest).toBe(true);

    // Heartbeat 3: renew → GET returns 'other-instance' → lose leadership
    await leader._heartbeatOnce();

    // Flush process.nextTick queue (onLoseLease fires inside nextTick)
    await vi.runAllTicks();

    // Verify callback path: onLoseLease called AND WS closed
    expect(onLoseLease).toHaveBeenCalledTimes(1);
    expect(mockWsClose).toHaveBeenCalledTimes(1);
    // No longer leader
    expect(leader.isLeaderForTest).toBe(false);
  });

  it('does not call onLoseLease when lease is still held', async () => {
    const { AriLeaderClient } = await import('../src/leader.js');

    const mockRedis = {
      get: vi.fn().mockResolvedValue('test-leader'),
      set: vi.fn().mockResolvedValue('OK'),
      pexpire: vi.fn().mockResolvedValue(1),
    };

    const onLoseLease = vi.fn();
    const leader = new AriLeaderClient({
      instanceId: 'test-leader',
      leaseKey: 'test:ari-leader',
      ttlMs: 1500,
      heartbeatMs: 500,
      redis: mockRedis as any,
      ariClientFactory: async () => ({
        start: vi.fn().mockResolvedValue(undefined),
        on: vi.fn(),
        stop: vi.fn(),
      } as any),
      onStasisStart: vi.fn(),
      onLoseLease,
    });

    await leader._heartbeatOnce(); // acquire
    await leader._heartbeatOnce(); // renew: GET returns 'test-leader' (still ours)
    await vi.runAllTicks();

    expect(onLoseLease).not.toHaveBeenCalled();
  });

  it('drops in-flight StasisStart events when isLeader is false (ADR-0016 split-brain guard)', async () => {
    const { AriLeaderClient } = await import('../src/leader.js');

    const mockRedis = {
      get: vi.fn().mockResolvedValue('test-leader'),
      set: vi.fn().mockResolvedValue('OK'),
      pexpire: vi.fn().mockResolvedValue(1),
    };

    let capturedHandler: ((...args: any[]) => void) | null = null;
    const mockAriClient = {
      _connection: { ws: { close: vi.fn() } },
      stop: vi.fn(),
      start: vi.fn().mockResolvedValue(undefined),
      on: vi.fn((event: string, handler: (...args: any[]) => void) => {
        if (event === 'StasisStart') capturedHandler = handler;
      }),
    };

    const onStasisStart = vi.fn();
    const leader = new AriLeaderClient({
      instanceId: 'test-leader',
      leaseKey: 'test:ari-leader',
      ttlMs: 1500,
      heartbeatMs: 500,
      redis: mockRedis as any,
      ariClientFactory: async () => mockAriClient as any,
      onStasisStart,
      onLoseLease: vi.fn(),
    });

    // Become leader so handler is registered
    await leader._heartbeatOnce();
    expect(capturedHandler).not.toBeNull();

    // Manually depose (simulate lost lease without going through heartbeat)
    (leader as any).isLeader = false;

    // Fire a StasisStart event while isLeader === false
    capturedHandler!({ channel: { id: 'ch-1', dialplan: {}, caller: {} }, application: 'ncall' });

    // onStasisStart must NOT be called — guard drops it
    expect(onStasisStart).not.toHaveBeenCalled();
  });
});
