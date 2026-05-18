// RED: fails because ArbiterService does not exist.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { ArbiterService } from './arbiter.service';
import { NatsClientService } from '../nats/nats-client.service';
import { NATS_CLIENT_TOKEN } from '../nats/nats.module';
import { WsGateway } from '../ws/ws.gateway';
import { DB_TOKEN } from '../database/database.module';
import type { NatsStasisStartPayload, WsIncomingCallPayload } from '@tas/shared-types';

const SEEDED_OPERATOR_ID = '66666666-6666-6666-6666-666666666666';

describe('ArbiterService', () => {
  let arbiter: ArbiterService;
  let module: TestingModule;

  const mockWsGateway = {
    sendToOperator: vi.fn(),
    sendCallEnded: vi.fn(),
    sendCallExhausted: vi.fn(),
    connectedOperatorIds: vi.fn(),
  };
  const mockNc = {
    publish: vi.fn(),
    subscribe: vi.fn().mockReturnValue({ unsubscribe: vi.fn() }),
  };
  const mockDb = {
    select: vi.fn(),
  };

  beforeAll(async () => {
    module = await Test.createTestingModule({
      providers: [
        ArbiterService,
        NatsClientService,
        { provide: NATS_CLIENT_TOKEN, useValue: mockNc },
        { provide: WsGateway, useValue: mockWsGateway },
        { provide: DB_TOKEN, useValue: mockDb },
      ],
    }).compile();
    arbiter = module.get(ArbiterService);
  });

  afterAll(async () => { await module.close(); });

  // Default: mockDb returns SEEDED_OPERATOR_ID so existing dispatch tests still pass.
  beforeEach(() => {
    mockDb.select = vi.fn().mockReturnValue({
      from: () => ({
        where: () => ({
          orderBy: () => ({
            limit: () => Promise.resolve([{ id: SEEDED_OPERATOR_ID }]),
          }),
        }),
      }),
    });
    mockWsGateway.sendToOperator.mockClear();
    mockWsGateway.sendCallEnded.mockClear();
    mockWsGateway.sendCallExhausted.mockClear();
    mockWsGateway.connectedOperatorIds.mockReturnValue([SEEDED_OPERATOR_ID]);
  });

  it('dispatch: picks seeded operator, sends WS event with type=incoming_call', async () => {
    const stasisPayload = {
      callId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      channel: 'test-channel',
      tenantId: '11111111-1111-1111-1111-111111111111',
      accountId: '22222222-2222-2222-2222-222222222222',
      fromE164: '',
    };

    // selectOperator will call select().from().where().orderBy().limit() for user query
    // but first it queries queueCall — need to set up both chained calls.
    // For the queueCall query (where().limit()), then user query (where().orderBy().limit()).
    mockDb.select = vi.fn()
      // First call: queueCall lookup — no attempts
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })
      // Second call: user lookup — returns SEEDED_OPERATOR_ID
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([{ id: SEEDED_OPERATOR_ID }]) }) }) }) });

    await arbiter.dispatch(stasisPayload);

    expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
      SEEDED_OPERATOR_ID,
      expect.objectContaining<Partial<WsIncomingCallPayload>>({
        type: 'incoming_call',
        callId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        tenantId: '11111111-1111-1111-1111-111111111111',
        accountId: '22222222-2222-2222-2222-222222222222',
      }),
    );

    const [, wsPayload] = mockWsGateway.sendToOperator.mock.calls[0] as [string, WsIncomingCallPayload];
    expect(wsPayload.type).toBe('incoming_call');
    expect(wsPayload.callId).toMatch(/^[0-9a-f-]{36}$/);
    expect(wsPayload.accountId).toBe('22222222-2222-2222-2222-222222222222');
  });

  it('dispatchCallEnded: forwards call.ended to seeded operator via sendCallEnded', () => {
    mockWsGateway.connectedOperatorIds.mockReturnValue([SEEDED_OPERATOR_ID]);

    arbiter.dispatchCallEnded({
      callId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      tenantId: '11111111-1111-1111-1111-111111111111',
      endedBy: 'caller',
      endedAt: new Date().toISOString(),
    });

    expect(mockWsGateway.sendCallEnded).toHaveBeenCalledWith(
      SEEDED_OPERATOR_ID,
      { callId: 'cccccccc-cccc-cccc-cccc-cccccccccccc', endedBy: 'caller' },
    );
  });

  it('forwards payload.fromE164 as callerE164 on the WS payload (HC#4)', async () => {
    mockWsGateway.sendToOperator.mockClear();
    mockDb.select = vi.fn()
      .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })
      .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([{ id: SEEDED_OPERATOR_ID }]) }) }) }) });
    const payload: NatsStasisStartPayload = {
      callId: '11111111-1111-1111-1111-111111111111',
      channel: 'PJSIP/sipp-00000001',
      tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      fromE164: '+15551234567',
    };
    await arbiter.dispatch(payload);
    expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ callerE164: '+15551234567' }),
    );
  });

  describe('exclusion-list selector', () => {
    it('picks the lowest-UUID operator not in queue_call.attempts', async () => {
      mockDb.select = vi.fn()
        // queueCall lookup — no existing attempts
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })
        // user lookup — returns target operator
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve([{ id: '77777777-7777-7777-7777-777777777771' }]),
              }),
            }),
          }),
        });
      mockWsGateway.sendToOperator.mockClear();
      await arbiter.dispatch({
        callId: '11111111-1111-1111-1111-111111111111',
        channel: 'PJSIP/sipp-00000001',
        tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        fromE164: '+15551234567',
      });
      expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
        '77777777-7777-7777-7777-777777777771',
        expect.objectContaining({ callId: '11111111-1111-1111-1111-111111111111' }),
      );
    });

    it('excludes operators already in queue_call.attempts and picks the next UUID', async () => {
      // queueCall lookup returns one attempt by operator A; user lookup must NOT include A.
      const declinedA = JSON.stringify({
        operatorId: '66666666-6666-6666-6666-666666666666',
        outcome: 'declined',
        at: '2026-05-18T12:00:00.000Z',
      });
      mockDb.select = vi.fn()
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ attempts: [declinedA] }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve([{ id: '77777777-7777-7777-7777-777777777771' }]),
              }),
            }),
          }),
        });
      mockWsGateway.sendToOperator.mockClear();
      await arbiter.dispatch({
        callId: '11111111-1111-1111-1111-111111111111',
        channel: 'PJSIP/sipp-00000001',
        tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        fromE164: '+15551234567',
      });
      expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
        '77777777-7777-7777-7777-777777777771',
        expect.any(Object),
      );
      expect(mockWsGateway.sendToOperator).not.toHaveBeenCalledWith(
        '66666666-6666-6666-6666-666666666666',
        expect.anything(),
      );
    });

    it('emits call.exhausted WS event when no operator is available', async () => {
      mockDb.select = vi.fn()
        // queueCall lookup
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }) })
        // user lookup — empty
        .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([]) }) }) }) });
      mockWsGateway.sendToOperator.mockClear();
      mockWsGateway.sendCallExhausted = vi.fn();
      await arbiter.dispatch({
        callId: '11111111-1111-1111-1111-111111111111',
        channel: 'PJSIP/sipp-00000001',
        tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        fromE164: '+15551234567',
      });
      expect(mockWsGateway.sendToOperator).not.toHaveBeenCalled();
      expect(mockWsGateway.sendCallExhausted).toHaveBeenCalledWith({
        callId: '11111111-1111-1111-1111-111111111111',
        tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      });
    });
  });

  describe('dispatchByCallId', () => {
    it('reads the call row and queue_call.attempts and dispatches to next available operator', async () => {
      const callRow = {
        id: '11111111-1111-1111-1111-111111111111',
        tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        fromE164: '+15551234567',
      };
      const queueCallRow = {
        attempts: [JSON.stringify({
          operatorId: '66666666-6666-6666-6666-666666666666',
          outcome: 'declined',
          at: '2026-05-18T12:00:00.000Z',
        })],
      };
      // Three select() calls: first for call row, second for queue_call row (in selectOperator), third for operator selector.
      const selectFn = vi.fn()
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([callRow]) }) }) })
        .mockReturnValueOnce({ from: () => ({ where: () => ({ limit: () => Promise.resolve([queueCallRow]) }) }) })
        .mockReturnValueOnce({ from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve([{ id: '77777777-7777-7777-7777-777777777771' }]) }) }) }) });
      mockDb.select = selectFn;
      mockWsGateway.sendToOperator.mockClear();
      await arbiter.dispatchByCallId('11111111-1111-1111-1111-111111111111');
      expect(mockWsGateway.sendToOperator).toHaveBeenCalledWith(
        '77777777-7777-7777-7777-777777777771',
        expect.objectContaining({ callerE164: '+15551234567' }),
      );
    });
  });

  describe('latency ring buffer', () => {
    it('records dispatch latency keyed by callId and exposes via getLatenciesForCall', async () => {
      // Use a unique callId not shared with any other test to avoid ring-buffer cross-contamination.
      const uniqueCallId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
      mockDb.select = vi.fn()
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ attempts: [] }]),
            }),
          }),
        })
        .mockReturnValueOnce({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve([{ id: '77777777-7777-7777-7777-777777777771' }]),
              }),
            }),
          }),
        });
      await arbiter.dispatch({
        callId: uniqueCallId,
        channel: 'PJSIP/sipp-00000001',
        tenantId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        accountId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        fromE164: '+15551234567',
      });
      const samples = arbiter.getLatenciesForCall(uniqueCallId);
      expect(samples).toHaveLength(1);
      expect(samples[0]).toBeGreaterThanOrEqual(0);
      expect(samples[0]).toBeLessThan(1000);
    });
  });
});
