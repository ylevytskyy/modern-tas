import {
  Global, Module, type OnApplicationShutdown, Inject, Injectable,
} from '@nestjs/common';
import { Client, Connection } from '@temporalio/client';
import { TEMPORAL_CLIENT_TOKEN } from './temporal.tokens';
import { TemporalClientService } from './temporal-client.service';

@Injectable()
class TemporalShutdown implements OnApplicationShutdown {
  constructor(@Inject(TEMPORAL_CLIENT_TOKEN) private readonly client: Client) {}
  async onApplicationShutdown(): Promise<void> {
    await this.client.connection.close();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: TEMPORAL_CLIENT_TOKEN,
      useFactory: async (): Promise<Client> => {
        const address = process.env.TEMPORAL_ADDRESS ?? 'localhost:7233';
        const namespace = process.env.TEMPORAL_NAMESPACE ?? 'default';
        const connection = await Connection.connect({ address });
        return new Client({ connection, namespace });
      },
    },
    TemporalClientService,
    TemporalShutdown,
  ],
  exports: [TemporalClientService],
})
export class TemporalModule {}
