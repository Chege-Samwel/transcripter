-- Auto-upgrade system models to fast, active live models on NVIDIA NIM API catalog
UPDATE transcripter_system_settings
SET value = jsonb_build_object(
  'primaryModel', 'meta/llama-3.1-8b-instruct',
  'fallbackModels', jsonb_build_array('meta/llama-3.2-3b-instruct', 'nvidia/llama-3.1-nemotron-70b-instruct', 'meta/llama-3.3-70b-instruct')
),
updated_at = NOW(),
updated_by = 'migration_0004'
WHERE key = 'system_models'
  AND (
    value->>'primaryModel' LIKE '%nemotron-ultra%'
    OR value->>'primaryModel' LIKE '%nemotron-nano%'
    OR value->>'primaryModel' LIKE '%nemotron-4b%'
    OR value->>'primaryModel' LIKE '%llama-3.1-70b%'
    OR value->>'primaryModel' IS NULL
    OR value->>'primaryModel' = ''
  );
