import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ArbiterService } from '../arbiter/arbiter.service';

@Controller('internal')
export class DispatchLatenciesController {
  constructor(private readonly arbiter: ArbiterService) {}

  @Get('dispatch-latencies')
  async get(
    @Headers('x-internal-token') token: string | undefined,
    @Query('callId') callId: string | undefined,
  ): Promise<{ samples: number[] }> {
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected || token !== expected) throw new UnauthorizedException();
    if (!callId) throw new BadRequestException('callId query param required');
    return { samples: this.arbiter.getLatenciesForCall(callId) };
  }
}
