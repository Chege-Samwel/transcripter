import { databaseConfigured, describeDatabaseError, getPool } from "./database";
import { databaseReadiness } from "./migrate";
import { MODEL_OPTIONS, MAX_ALTERNATIVES } from "./workflow";

export type SystemModels = {
  primaryModel: string;
  fallbackModels: string[];
  updatedAt?: string;
  updatedBy?: string;
};

export const DEFAULT_SYSTEM_MODELS: SystemModels = {
  primaryModel: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  fallbackModels: [
    "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
    "meta/llama-3.1-70b-instruct",
  ],
};

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
          const primaryModel = typeof val.primaryModel === "string" && val.primaryModel.trim()
            ? val.primaryModel.trim()
            : DEFAULT_SYSTEM_MODELS.primaryModel;
          const fallbackModels = Array.isArray(val.fallbackModels)
            ? val.fallbackModels
                .filter((m: unknown): m is string => typeof m === "string" && m.trim().length > 0)
                .slice(0, MAX_ALTERNATIVES)
            : DEFAULT_SYSTEM_MODELS.fallbackModels;
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
  const cleanPrimary = (primaryModel || "").trim() || DEFAULT_SYSTEM_MODELS.primaryModel;
  const cleanFallbacks = (Array.isArray(fallbackModels) ? fallbackModels : [])
    .map((m) => (typeof m === "string" ? m.trim() : ""))
    .filter(Boolean)
    .slice(0, MAX_ALTERNATIVES);

  const payload: SystemModels = {
    primaryModel: cleanPrimary,
    fallbackModels: cleanFallbacks,
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
        [JSON.stringify({ primaryModel: cleanPrimary, fallbackModels: cleanFallbacks }), updatedBy]
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
