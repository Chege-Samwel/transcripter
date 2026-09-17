-- Auto-upgrade system models to Google AI Studio & NVIDIA NIM active live models
UPDATE transcripter_system_settings
SET value = jsonb_build_object(
  'primaryModel', 'gemini-2.0-flash',
  'fallbackModels', jsonb_build_array('gemini-1.5-flash', 'meta/llama-3.3-70b-instruct', 'meta/llama-3.1-8b-instruct')
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
