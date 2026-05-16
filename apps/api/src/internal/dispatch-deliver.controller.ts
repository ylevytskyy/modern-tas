import {
  Body, Controller, Headers, HttpCode, Post, UnauthorizedException,
} from '@nestjs/common';
import { WsGateway } from '../ws/ws.gateway';

interface DeliverBody {
  messageId: string;
  operatorId: string;
  payload: unknown;
}

@Controller('internal')
export class DispatchDeliverController {
  constructor(private readonly ws: WsGateway) {}

  @Post('dispatch-deliver')
  @HttpCode(200)
  async deliver(
    @Headers('x-internal-token') token: string | undefined,
    @Body() body: DeliverBody,
  ): Promise<{ delivered: boolean }> {
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected || token !== expected) throw new UnauthorizedException();
    this.ws.sendToOperator(body.operatorId, body.payload as any);
    return { delivered: true };
  }
}
