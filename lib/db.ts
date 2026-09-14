import { neon } from "@neondatabase/serverless";
import type { SectionCheck, WorkflowConfig } from "./workflow";

export type StoredWorkflow = {
  config: WorkflowConfig;
  result: string;
  crossChecks: SectionCheck[];
  updatedAt?: string;
};

function databaseUrl() {
  return process.env.DATABASE_URL?.trim();
}

export function databaseConfigured() {
  return Boolean(databaseUrl());
}

export async function loadWorkflow(email: string): Promise<StoredWorkflow | null> {
  const url = databaseUrl();
  if (!url) return null;
  const sql = neon(url);
  try {
    const rows = await sql`SELECT config, result, cross_checks, updated_at FROM transcripter_workflows WHERE owner_email = ${email} LIMIT 1` as {
      config: unknown;
      result: string;
      cross_checks: unknown;
      updated_at: string;
    }[];
    const row = rows[0];
    if (!row) return null;
    return {
      config: row.config as WorkflowConfig,
      result: row.result || "",
      crossChecks: Array.isArray(row.cross_checks) ? row.cross_checks as SectionCheck[] : [],
      updatedAt: row.updated_at,
    };
  } catch (error) {
    // A missing table should be fixed with db/schema.sql, not surfaced as a
    // broken editing experience. The route reports persistence separately.
    console.error("Could not load workflow from Neon", error);
    return null;
  }
}

export async function saveWorkflow(email: string, workflow: StoredWorkflow) {
  const url = databaseUrl();
  if (!url) return false;
  const sql = neon(url);
  try {
    await sql`
      INSERT INTO transcripter_workflows (owner_email, config, result, cross_checks, updated_at)
      VALUES (${email}, ${JSON.stringify(workflow.config)}::jsonb, ${workflow.result || ""}, ${JSON.stringify(workflow.crossChecks || [])}::jsonb, NOW())
      ON CONFLICT (owner_email) DO UPDATE SET
        config = EXCLUDED.config,
        result = EXCLUDED.result,
        cross_checks = EXCLUDED.cross_checks,
        updated_at = NOW()
    `;
    return true;
  } catch (error) {
    console.error("Could not save workflow to Neon", error);
    return false;
  }
}
