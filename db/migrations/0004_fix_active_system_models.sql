-- Auto-upgrade system models to user cascade defaults (NVIDIA Nemotron 3.5 Lightning, Nemotron 3 Ultra, OpenRouter Gemma, Google Gemini)
UPDATE transcripter_system_settings
SET value = jsonb_build_object(
  'primaryModel', 'nvidia/nemotron-3.5-lightning:free',
  'fallbackModels', jsonb_build_array('nvidia/nemotron-3.5-lightning', 'nvidia/nemotron-3-ultra-550b-a55b', 'google/gemma-4-26b-a4b-it:free', 'gemini-2.0-flash')
),
updated_at = NOW(),
updated_by = 'migration_0004'
WHERE key = 'system_models'
  AND (
    value->>'primaryModel' LIKE '%llama-3.1-8b%'
    OR value->>'primaryModel' LIKE '%llama-3.2-3b%'
    OR value->>'primaryModel' LIKE '%nemotron-ultra-253b%'
    OR value->>'primaryModel' LIKE '%nemotron-nano%'
    OR value->>'primaryModel' LIKE '%nemotron-4b%'
    OR value->>'primaryModel' LIKE '%llama-3.1-70b%'
    OR value->>'primaryModel' IS NULL
    OR value->>'primaryModel' = ''
  );
