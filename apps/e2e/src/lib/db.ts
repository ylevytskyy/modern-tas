import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from '@tas/db';

const url = process.env.E2E_DATABASE_URL ?? 'postgres://tas:tas@localhost:5432/tas';

let _client: postgres.Sql | null = null;
let _db: ReturnType<typeof drizzle> | null = null;

export function getDb() {
  if (!_db) {
    _client = postgres(url, { max: 1, prepare: false });
    _db = drizzle(_client, { schema });
  }
  return _db;
}

export async function closeDb() {
  if (_client) {
    await _client.end({ timeout: 1 });
    _client = null;
    _db = null;
  }
}

export { schema };
