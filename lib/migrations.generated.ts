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
  { version: "0002", name: "0002_accounts_jobs_enums", sql: `-- 0002: account approvals, jobs history, enums, and error logging.
-- Concurrent-safe: enum creation uses DO blocks; tables use IF NOT EXISTS.
-- Existing transcripter_workflows rows are copied into jobs as a one-time import.

DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('awaiting_approval', 'approved', 'suspended');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('editor', 'admin');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE job_kind AS ENUM ('demo', 'job');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE job_status AS ENUM ('draft', 'running', 'paused', 'complete', 'failed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

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

INSERT INTO transcripter_jobs (
  id, owner_email, title, kind, status, config, source, source_file_name,
  stages, result, cross_checks, word_count
)
SELECT
  'imported-' || md5(owner_email),
  owner_email,
  COALESCE(NULLIF(config->>'name', ''), 'Imported edit'),
  'job',
  CASE WHEN COALESCE(result, '') = '' THEN 'draft' ELSE 'complete' END,
  config,
  COALESCE(config->>'transcript', ''),
  COALESCE(config->>'sourceFileName', ''),
  jsonb_build_object('normalize', '', 'format', '', 'edit', COALESCE(result, ''), 'refine', ''),
  COALESCE(result, ''),
  COALESCE(cross_checks, '[]'::jsonb),
  0
FROM transcripter_workflows
ON CONFLICT (id) DO NOTHING;` },
];
