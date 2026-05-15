import { Global, Module } from '@nestjs/common';
import { makeDb } from '@ncall/db/client';
import type { Db } from '@ncall/db/client';

export const DB_TOKEN = 'DB';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: (): Db =>
        makeDb(
          process.env.DATABASE_URL ??
            'postgres://ncall.ncall:ncall@localhost:6543/ncall',
        ),
    },
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule {}
