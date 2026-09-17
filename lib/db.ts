import { databaseConfigured, databaseUrl, describeDatabaseError, getPool } from "./database";
import { databaseReadiness } from "./migrate";
import type { SectionCheck, WorkflowConfig } from "./workflow";

// Public surface for API routes.
export { databaseConfigured } from "./database";
export { databaseReadiness, type DatabaseReadiness } from "./migrate";

export type StoredWorkflow = {
  config: WorkflowConfig;
  result: string;
  crossChecks: SectionCheck[];
  updatedAt?: string;
};

export type SaveResult = {
  persisted: boolean;
  error?: string;
};

function parseJson(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  return value;
}

export async function loadWorkflow(email: string): Promise<StoredWorkflow | null> {
  if (!databaseConfigured()) return null;
  const readiness = await databaseReadiness();
  if (readiness.error) return null;
  try {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        "SELECT config, result, cross_checks, updated_at FROM transcripter_workflows WHERE owner_email = $1 LIMIT 1",
        [email],
      );
      const row = result.rows[0] as
        | { config: unknown; result: string | null; cross_checks: unknown; updated_at: Date | string | null }
        | undefined;
      if (!row) return null;
      const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at || undefined;
      return {
        config: (parseJson(row.config) || {}) as WorkflowConfig,
        result: row.result || "",
        crossChecks: Array.isArray(parseJson(row.cross_checks)) ? (parseJson(row.cross_checks) as SectionCheck[]) : [],
        updatedAt,
      };
    } finally {
      client.release();
    }
  } catch (error) {
    // Read path stays graceful: the browser draft cache covers a temporary
    // database outage. The /api/workflow response reports the real error.
    console.error("Could not load workflow from database", error);
    return null;
  }
}

export async function saveWorkflow(email: string, workflow: StoredWorkflow): Promise<SaveResult> {
  const url = databaseUrl();
  if (!url) {
    return { persisted: false, error: "No database is configured. Set DATABASE_URL to enable server saving." };
  }
  const readiness = await databaseReadiness();
  if (readiness.error) return { persisted: false, error: readiness.error };
  try {
    const client = await getPool().connect();
    try {
      await client.query(
        `INSERT INTO transcripter_workflows (owner_email, config, result, cross_checks, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (owner_email) DO UPDATE SET
           config = EXCLUDED.config,
           result = EXCLUDED.result,
           cross_checks = EXCLUDED.cross_checks,
           updated_at = NOW()`,
        [email, JSON.stringify(workflow.config), workflow.result || "", JSON.stringify(workflow.crossChecks || [])],
      );
    } finally {
      client.release();
    }
    return { persisted: true };
  } catch (error) {
    console.error("Could not save workflow to database", error);
    return { persisted: false, error: describeDatabaseError(error) };
  }
}
