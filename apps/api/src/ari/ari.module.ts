import { Global, Module } from '@nestjs/common';
import { AriLeaderClient } from '@ncall/ari-client';
import Redis from 'ioredis';

export const ARI_LEADER_TOKEN = 'ARI_LEADER';

@Global()
@Module({
  providers: [
    {
      provide: ARI_LEADER_TOKEN,
      useFactory: (): AriLeaderClient => {
        const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379');
        const ariConnect = require('ari-client') as {
          connect: (url: string, user: string, pass: string) => Promise<any>;
        };
        const ariUrl = process.env.ARI_URL ?? 'http://localhost:8088';
        const ariUser = process.env.ARI_USER ?? 'ncall';
        const ariPass = process.env.ARI_PASS ?? 'ncall';

        const leader = new AriLeaderClient({
          instanceId: process.env.INSTANCE_ID ?? `api-${process.pid}`,
          leaseKey: `ncall:ari-leader:${process.env.ASTERISK_ID ?? 'asterisk-1'}`,
          ttlMs: Number(process.env.ARI_LEASE_TTL_MS ?? 1500),
          heartbeatMs: Number(process.env.ARI_HEARTBEAT_MS ?? 500),
          redis,
          ariClientFactory: async (appName) => {
            const client = await ariConnect.connect(ariUrl, ariUser, ariPass);
            return client;
          },
          onStasisStart: () => {
            // No-op at module level; wired by StasisStartHandler.onModuleInit() via setStasisStartCallback().
            // TODO Chunk 7: StasisStart events that fire before TelephonyModule.onModuleInit() wires the
            //               callback are silently dropped (PoC limitation; non-deterministic race, low probability).
          },
          onLoseLease: () => {
            // No-op at module level; leader closes the WS internally in _loseLeadership().
          },
        });

        return leader;
      },
    },
  ],
  exports: [ARI_LEADER_TOKEN],
})
export class AriModule {}
