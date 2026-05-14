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
            'postgres://ncall:ncall@localhost:6543/ncall.ncall',
        ),
    },
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule {}
