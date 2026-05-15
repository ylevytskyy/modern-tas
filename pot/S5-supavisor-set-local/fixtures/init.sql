-- Bootstrap state Supavisor expects but doesn't self-create:
--   * `_supavisor` database for its metadata (DATABASE_URL points here).
--   * `_supavisor` schema inside it; Ecto migrations create their tables under this schema.
-- The matching `supavisor-migrate` one-shot service in docker-compose.yml then
-- runs `bin/supavisor eval Supavisor.Release.migrate` to populate the schema.

CREATE DATABASE _supavisor;
\connect _supavisor
CREATE SCHEMA _supavisor;
