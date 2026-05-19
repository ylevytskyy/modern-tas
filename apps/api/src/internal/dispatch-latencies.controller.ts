import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  NotFoundException,
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
    // Defense in depth: hard-block in production regardless of token state.
    // Matches /v1/dev/operator-token's NODE_ENV guard. The x-internal-token
    // check below is the primary guard in dev/CI; this is the safety net.
    if (process.env.NODE_ENV === 'production') {
      throw new NotFoundException();
    }
    const expected = process.env.INTERNAL_API_TOKEN;
    if (!expected || token !== expected) throw new UnauthorizedException();
    if (!callId) throw new BadRequestException('callId query param required');
    return { samples: this.arbiter.getLatenciesForCall(callId) };
  }
}
