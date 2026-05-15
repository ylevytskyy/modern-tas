import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'child_process';
import path from 'path';

let container: StartedPostgreSqlContainer;

export async function setup() {
  container = await new PostgreSqlContainer('postgres:15')
    .withDatabase('tas')
    .withUsername('tas')
    .withPassword('tas')
    .start();

  const url = container.getConnectionUri();
  process.env.DATABASE_URL = url;
  process.env.TEST_DATABASE_URL = url;

  const migrateScript = path.resolve(__dirname, '../src/migrate.ts');
  execSync(`tsx ${migrateScript}`, {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}

export async function teardown() {
  await container?.stop();
}
