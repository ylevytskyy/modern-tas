import { Module } from '@nestjs/common';
import { ArbiterService } from './arbiter.service';
import { NatsModule } from '../nats/nats.module';
import { WsModule } from '../ws/ws.module';

@Module({
  imports: [NatsModule, WsModule],
  providers: [ArbiterService],
  exports: [ArbiterService],
})
export class ArbiterModule {}
