-- 0003: system models configuration (admin-only) and workflow templates.

CREATE TABLE IF NOT EXISTS transcripter_system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

INSERT INTO transcripter_system_settings (key, value, updated_by)
VALUES (
  'system_models',
  jsonb_build_object(
    'primaryModel', 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
    'fallbackModels', jsonb_build_array('nvidia/llama-3.1-nemotron-nano-vl-8b-v1', 'meta/llama-3.1-70b-instruct')
  ),
  'system'
)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS transcripter_workflow_templates (
  id TEXT PRIMARY KEY,
  owner_email TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'general',
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS transcripter_workflow_templates_owner_idx
  ON transcripter_workflow_templates (owner_email, updated_at DESC);
