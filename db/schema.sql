-- Full current schema, kept in sync with db/migrations/ for reference.
--
-- Migrations are the source of truth and are applied automatically by the
-- app on first use (lib/migrate.ts) or manually with "npm run db:migrate".
-- There is no manual setup step required in a new Neon database.

CREATE TABLE IF NOT EXISTS transcripter_workflows (
  owner_email TEXT PRIMARY KEY,
  config JSONB NOT NULL,
  result TEXT NOT NULL DEFAULT '',
  cross_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transcripter_workflows_updated_at_idx
  ON transcripter_workflows (updated_at DESC);

-- Applied-migration bookkeeping (managed by the migrator).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
