import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import path from "path";

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://tas:tas@localhost:5432/tas";
  const sql = postgres(url, { max: 1 });
  const db = drizzle(sql);
  await migrate(db, { migrationsFolder: path.join(__dirname, "../drizzle") });
  console.log("Migrations applied successfully.");
  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
