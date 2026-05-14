import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema";

export function makeDb(url: string) {
  const sql = postgres(url, { prepare: false }); // Supavisor-friendly: no prepared statements
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof makeDb>;
