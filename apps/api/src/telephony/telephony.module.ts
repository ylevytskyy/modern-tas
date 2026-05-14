import { Module } from '@nestjs/common';
import { StasisStartHandler } from './stasis-start.handler';
import { NatsModule } from '../nats/nats.module';
import { AriModule } from '../ari/ari.module';

@Module({
  imports: [NatsModule, AriModule],
  providers: [StasisStartHandler],
  exports: [StasisStartHandler],
})
export class TelephonyModule {}
