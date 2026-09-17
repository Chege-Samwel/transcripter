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

CREATE TYPE user_status AS ENUM ('awaiting_approval', 'approved', 'suspended');
CREATE TYPE user_role AS ENUM ('editor', 'admin');
CREATE TYPE job_kind AS ENUM ('demo', 'job');
CREATE TYPE job_status AS ENUM ('draft', 'running', 'paused', 'complete', 'failed');

CREATE TABLE IF NOT EXISTS transcripter_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  status user_status NOT NULL DEFAULT 'awaiting_approval',
  role user_role NOT NULL DEFAULT 'editor',
  workspace_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  approved_by TEXT
);

CREATE INDEX IF NOT EXISTS transcripter_users_status_idx
  ON transcripter_users (status, created_at DESC);

CREATE TABLE IF NOT EXISTS transcripter_jobs (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Untitled transcript',
  kind job_kind NOT NULL DEFAULT 'demo',
  status job_status NOT NULL DEFAULT 'draft',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL DEFAULT '',
  source_file_name TEXT NOT NULL DEFAULT '',
  stages JSONB NOT NULL DEFAULT '{}'::jsonb,
  batches JSONB NOT NULL DEFAULT '[]'::jsonb,
  result TEXT NOT NULL DEFAULT '',
  cross_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  resume_cursor JSONB,
  word_count INTEGER NOT NULL DEFAULT 0,
  error_log JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transcripter_jobs_owner_updated_idx
  ON transcripter_jobs (owner_email, updated_at DESC);

CREATE TABLE IF NOT EXISTS transcripter_error_events (
  id TEXT PRIMARY KEY,
  owner_email TEXT NOT NULL,
  job_id TEXT,
  stage TEXT,
  batch INTEGER,
  code TEXT,
  message TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transcripter_error_events_created_idx
  ON transcripter_error_events (created_at DESC);

-- Applied-migration bookkeeping (managed by the migrator).
CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
