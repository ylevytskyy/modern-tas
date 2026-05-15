import { Module } from '@nestjs/common';
import { StasisStartHandler } from './stasis-start.handler';
import { NatsModule } from '../nats/nats.module';
import { AriModule } from '../ari/ari.module';
import { RecordingModule } from '../recording/recording.module';

@Module({
  imports: [NatsModule, AriModule, RecordingModule],
  providers: [StasisStartHandler],
  exports: [StasisStartHandler],
})
export class TelephonyModule {}
