import { Module } from '@nestjs/common';
import { StasisStartHandler } from './stasis-start.handler';
import { StasisEndHandler } from './stasis-end.handler';
import { NatsModule } from '../nats/nats.module';
import { AriModule } from '../ari/ari.module';
import { RecordingModule } from '../recording/recording.module';

@Module({
  imports: [NatsModule, AriModule, RecordingModule],
  providers: [StasisStartHandler, StasisEndHandler],
  exports: [StasisStartHandler, StasisEndHandler],
})
export class TelephonyModule {}
