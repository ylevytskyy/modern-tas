import { Injectable, Inject } from '@nestjs/common';
import type { NatsConnection } from 'nats';
import { StringCodec } from 'nats';
import { NATS_CLIENT_TOKEN } from './nats.tokens';

const sc = StringCodec();

@Injectable()
export class NatsClientService {
  constructor(
    @Inject(NATS_CLIENT_TOKEN) private readonly nc: NatsConnection,
  ) {}

  publish<T>(subject: string, payload: T): void {
    const encoded = sc.encode(JSON.stringify(payload));
    this.nc.publish(subject, encoded);
  }

  subscribe<T>(subject: string, handler: (payload: T) => void): { unsubscribe(): void } {
    const sub = this.nc.subscribe(subject, {
      callback: (_err, msg) => {
        if (msg) {
          try {
            handler(JSON.parse(sc.decode(msg.data)) as T);
          } catch {
            // malformed message — skip
          }
        }
      },
    });
    return sub;
  }
}
