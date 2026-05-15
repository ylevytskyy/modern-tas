import { Global, Module } from '@nestjs/common';
import { makeDb } from '@tas/db/client';
import type { Db } from '@tas/db/client';

export const DB_TOKEN = 'DB';

@Global()
@Module({
  providers: [
    {
      provide: DB_TOKEN,
      useFactory: (): Db =>
        makeDb(
          process.env.DATABASE_URL ??
            'postgres://tas.tas:tas@localhost:6543/tas',
        ),
    },
  ],
  exports: [DB_TOKEN],
})
export class DatabaseModule {}
