// Auto-generated from db/migrations/*.sql by scripts/generate-migrations.mjs.
// Do not edit by hand — edit the .sql files and run "npm run db:generate".
export type Migration = { version: string; name: string; sql: string };

export const MIGRATIONS: Migration[] = [
  { version: "0001", name: "0001_initial_schema", sql: `-- 0001: initial schema — per-editor workflow storage.
-- Applied automatically on first use (see lib/migrate.ts) or manually with
-- "npm run db:migrate". Every statement must be idempotent so concurrent
-- cold starts and re-runs are safe.

CREATE TABLE IF NOT EXISTS transcripter_workflows (
  owner_email TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  result TEXT NOT NULL DEFAULT '',
  cross_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transcripter_workflows_updated_at_idx
  ON transcripter_workflows (updated_at DESC);` },
];
