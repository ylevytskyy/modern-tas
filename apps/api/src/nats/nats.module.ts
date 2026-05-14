import { Global, Module } from '@nestjs/common';
import { connect } from 'nats';
import type { NatsConnection } from 'nats';
import { NatsClientService } from './nats-client.service';

export const NATS_CLIENT_TOKEN = 'NATS_CLIENT';

@Global()
@Module({
  providers: [
    {
      provide: NATS_CLIENT_TOKEN,
      useFactory: async (): Promise<NatsConnection> => {
        const url = process.env.NATS_URL ?? 'nats://localhost:4222';
        return connect({ servers: url });
      },
    },
    NatsClientService,
  ],
  exports: [NatsClientService],
})
export class NatsModule {}
