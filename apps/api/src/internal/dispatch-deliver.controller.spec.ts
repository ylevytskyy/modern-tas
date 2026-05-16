import { describe, it, expect, beforeAll } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { DispatchDeliverController } from './dispatch-deliver.controller';
import { WsGateway } from '../ws/ws.gateway';

describe('DispatchDeliverController', () => {
  let controller: DispatchDeliverController;
  const sentTo: Array<{ operatorId: string; payload: unknown }> = [];

  beforeAll(async () => {
    process.env.INTERNAL_API_TOKEN = 'unit-test-secret-token';
    const fakeGateway = {
      sendToOperator: (operatorId: string, payload: unknown) => {
        sentTo.push({ operatorId, payload });
      },
    } as unknown as WsGateway;
    const mod: TestingModule = await Test.createTestingModule({
      controllers: [DispatchDeliverController],
      providers: [{ provide: WsGateway, useValue: fakeGateway }],
    }).compile();
    controller = mod.get(DispatchDeliverController);
  });

  it('sends to the operator and returns delivered:true when header is valid', async () => {
    const out = await controller.deliver('unit-test-secret-token', {
      messageId: 'm-1', operatorId: 'op-1', payload: { body: 'hi' },
    });
    expect(out).toEqual({ delivered: true });
    expect(sentTo.at(-1)).toEqual({ operatorId: 'op-1', payload: { body: 'hi' } });
  });

  it('throws 401 when the header is missing', async () => {
    await expect(controller.deliver(undefined as any, {
      messageId: 'm', operatorId: 'op', payload: {},
    })).rejects.toThrow(/unauthorized/i);
  });

  it('throws 401 when the header is wrong', async () => {
    await expect(controller.deliver('wrong', {
      messageId: 'm', operatorId: 'op', payload: {},
    })).rejects.toThrow(/unauthorized/i);
  });
});
