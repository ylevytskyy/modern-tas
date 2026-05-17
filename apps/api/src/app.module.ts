import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AuthModule } from './auth/auth.module';
import { AccountModule } from './account/account.module';
import { ContactModule } from './contact/contact.module';
import { FormModule } from './form/form.module';
import { MessageModule } from './message/message.module';
import { NatsModule } from './nats/nats.module';
import { RedisModule } from './redis/redis.module';
import { AriModule } from './ari/ari.module';
import { TelephonyModule } from './telephony/telephony.module';
import { ArbiterModule } from './arbiter/arbiter.module';
import { WsModule } from './ws/ws.module';
import { RecordingModule } from './recording/recording.module';
import { TemporalModule } from './temporal/temporal.module';
import { DevModule } from './dev/dev.module';
import { HealthModule } from './health/health.module';
import { InternalModule } from './internal/internal.module';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    NatsModule,
    RedisModule,
    AriModule,
    AccountModule,
    ContactModule,
    FormModule,
    MessageModule,
    TelephonyModule,
    ArbiterModule,
    WsModule,
    RecordingModule,
    TemporalModule,
    DevModule,
    HealthModule,
    InternalModule,
  ],
})
export class AppModule {}
