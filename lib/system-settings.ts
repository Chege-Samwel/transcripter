import { databaseConfigured, describeDatabaseError, getPool } from "./database";
import { databaseReadiness } from "./migrate";
import { MAX_ALTERNATIVES } from "./workflow";

export type SystemModels = {
  primaryModel: string;
  fallbackModels: string[];
  updatedAt?: string;
  updatedBy?: string;
};

// Actively supported models across Google AI Studio & NVIDIA NIM
export const DEFAULT_SYSTEM_MODELS: SystemModels = {
  primaryModel: "gemini-2.0-flash",
  fallbackModels: [
    "gemini-1.5-flash",
    "meta/llama-3.3-70b-instruct",
    "meta/llama-3.1-8b-instruct",
  ],
};

const RETIRED_MODELS = new Set([
  "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "llama-3.1-nemotron-ultra-253b-v1",
  "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
  "llama-3.1-nemotron-nano-vl-8b-v1",
  "nvidia/llama-3.1-nemotron-4b-instruct",
  "llama-3.1-nemotron-4b-instruct",
  "meta/llama-3.1-70b-instruct",
  "llama-3.1-70b-instruct",
]);

export function isRetiredModel(model: string): boolean {
  if (!model || typeof model !== "string") return true;
  const trimmed = model.trim();
  const lower = trimmed.toLowerCase();
  if (RETIRED_MODELS.has(trimmed) || RETIRED_MODELS.has(lower)) return true;
  if (lower.includes("nemotron-ultra") || lower.includes("nemotron-nano") || lower.includes("nemotron-4b")) return true;
  if (lower.includes("llama-3.1-70b")) return true;
  return false;
}

export function sanitizeModel(model: string, fallback: string): string {
  const trimmed = (model || "").trim();
  if (!trimmed || isRetiredModel(trimmed)) return fallback;
  return trimmed;
}

let cachedModels: SystemModels = { ...DEFAULT_SYSTEM_MODELS };

export async function getSystemModels(): Promise<SystemModels> {
  if (!databaseConfigured()) {
    return { ...cachedModels };
  }
  const readiness = await databaseReadiness();
  if (readiness.error) {
    return { ...cachedModels };
  }
  try {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        "SELECT value, updated_at, updated_by FROM transcripter_system_settings WHERE key = 'system_models' LIMIT 1"
      );
      if (result.rows.length > 0) {
        const row = result.rows[0];
        const val = typeof row.value === "string" ? JSON.parse(row.value) : row.value;
        if (val && typeof val === "object") {
          const rawPrimary = typeof val.primaryModel === "string" ? val.primaryModel.trim() : "";
          const primaryModel = sanitizeModel(rawPrimary, DEFAULT_SYSTEM_MODELS.primaryModel);

          let fallbackModels = Array.isArray(val.fallbackModels)
            ? (val.fallbackModels as unknown[])
                .filter((m: unknown): m is string => typeof m === "string" && m.trim().length > 0)
                .map((m: string) => sanitizeModel(m, ""))
                .filter(Boolean)
                .slice(0, MAX_ALTERNATIVES)
            : DEFAULT_SYSTEM_MODELS.fallbackModels;

          if (fallbackModels.length === 0) {
            fallbackModels = [...DEFAULT_SYSTEM_MODELS.fallbackModels];
          }

          // If the stored value had retired models, self-heal the database row in the background
          if (isRetiredModel(rawPrimary) || (Array.isArray(val.fallbackModels) && val.fallbackModels.some(isRetiredModel))) {
            client.query(
              `UPDATE transcripter_system_settings
               SET value = $1, updated_at = NOW(), updated_by = 'auto_heal'
               WHERE key = 'system_models'`,
              [JSON.stringify({ primaryModel, fallbackModels })]
            ).catch(() => {});
          }

          const loaded: SystemModels = {
            primaryModel,
            fallbackModels,
            updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at || undefined,
            updatedBy: row.updated_by || undefined,
          };
          cachedModels = loaded;
          return loaded;
        }
      }
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Could not load system models from database", error);
  }
  return { ...cachedModels };
}

export async function saveSystemModels(
  primaryModel: string,
  fallbackModels: string[],
  updatedBy: string
): Promise<{ ok: boolean; error?: string; models?: SystemModels }> {
  const cleanPrimary = sanitizeModel(primaryModel, DEFAULT_SYSTEM_MODELS.primaryModel);
  const cleanFallbacks = (Array.isArray(fallbackModels) ? fallbackModels : [])
    .map((m) => (typeof m === "string" ? sanitizeModel(m, "") : ""))
    .filter(Boolean)
    .slice(0, MAX_ALTERNATIVES);

  const finalFallbacks = cleanFallbacks.length > 0 ? cleanFallbacks : [...DEFAULT_SYSTEM_MODELS.fallbackModels];

  const payload: SystemModels = {
    primaryModel: cleanPrimary,
    fallbackModels: finalFallbacks,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || "admin",
  };

  cachedModels = payload;

  if (!databaseConfigured()) {
    return { ok: true, models: payload };
  }

  const readiness = await databaseReadiness();
  if (readiness.error) {
    return { ok: false, error: readiness.error };
  }

  try {
    const client = await getPool().connect();
    try {
      await client.query(
        `INSERT INTO transcripter_system_settings (key, value, updated_at, updated_by)
         VALUES ('system_models', $1, NOW(), $2)
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
        [JSON.stringify({ primaryModel: cleanPrimary, fallbackModels: finalFallbacks }), updatedBy]
      );
    } finally {
      client.release();
    }
    return { ok: true, models: payload };
  } catch (error) {
    console.error("Could not save system models to database", error);
    return { ok: false, error: describeDatabaseError(error) };
  }
}
