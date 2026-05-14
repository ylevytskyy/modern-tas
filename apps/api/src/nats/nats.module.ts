import { Global, Module } from '@nestjs/common';
import { connect } from 'nats';
import type { NatsConnection } from 'nats';
import { NatsClientService } from './nats-client.service';
import { NATS_CLIENT_TOKEN } from './nats.tokens';

export { NATS_CLIENT_TOKEN } from './nats.tokens';

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
