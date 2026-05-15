-- Bootstrap state Supavisor expects but doesn't self-create:
--   * `_supavisor` database for its metadata (DATABASE_URL points here).
--   * `_supavisor` schema inside it; Ecto migrations create their tables under this schema.
-- The matching `supavisor-migrate` one-shot service in docker-compose.yml then
-- runs `bin/supavisor eval Supavisor.Release.migrate` to populate the schema.

CREATE DATABASE _supavisor;
\connect _supavisor
CREATE SCHEMA _supavisor;

-- Create the application user that Drizzle/seed uses.
-- \connect ncall works because POSTGRES_DB=ncall is created before init scripts run.
\connect ncall
CREATE USER ncall WITH PASSWORD 'ncall';
GRANT ALL PRIVILEGES ON DATABASE ncall TO ncall;
-- Postgres 15: GRANT ALL PRIVILEGES ON DATABASE does NOT convey CREATE on public schema.
-- This explicit schema grant is required for drizzle-kit migrate to create tables.
GRANT ALL ON SCHEMA public TO ncall;
ALTER USER ncall CREATEDB;
