import { databaseConfigured, describeDatabaseError, getPool } from "./database";
import { databaseReadiness } from "./migrate";
import { parseJobRecord, type JobRecord } from "./types";
import type { SectionCheck, WorkflowConfig } from "./workflow";

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

function mapRow(row: Record<string, unknown>): JobRecord | null {
  const createdAt = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || "");
  const updatedAt = row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at || "");
  return parseJobRecord({
    id: row.id,
    ownerEmail: row.owner_email,
    title: row.title,
    kind: row.kind,
    status: row.status,
    config: parseJson(row.config),
    source: row.source,
    sourceFileName: row.source_file_name,
    stages: parseJson(row.stages),
    batches: parseJson(row.batches),
    result: row.result,
    crossChecks: parseJson(row.cross_checks),
    resumeCursor: parseJson(row.resume_cursor),
    wordCount: row.word_count,
    errorLog: parseJson(row.error_log),
    createdAt,
    updatedAt,
  });
}

async function readyPool() {
  if (!databaseConfigured()) return null;
  const readiness = await databaseReadiness();
  if (readiness.error) return null;
  return getPool();
}

export async function listJobs(email: string): Promise<JobRecord[]> {
  const pool = await readyPool();
  if (!pool) return [];
  try {
    const result = await pool.query(
      `SELECT id, owner_email, title, kind, status, config, source, source_file_name, stages, batches, result,
              cross_checks, resume_cursor, word_count, error_log, created_at, updated_at
       FROM transcripter_jobs
       WHERE owner_email = $1
       ORDER BY updated_at DESC
       LIMIT 80`,
      [email],
    );
    return result.rows.map((row) => mapRow(row as Record<string, unknown>)).filter((job): job is JobRecord => Boolean(job));
  } catch (error) {
    console.error("Transcripter: could not list jobs", error);
    return [];
  }
}

export async function getJob(email: string, id: string): Promise<JobRecord | null> {
  const pool = await readyPool();
  if (!pool) return null;
  try {
    const result = await pool.query(
      `SELECT id, owner_email, title, kind, status, config, source, source_file_name, stages, batches, result,
              cross_checks, resume_cursor, word_count, error_log, created_at, updated_at
       FROM transcripter_jobs
       WHERE owner_email = $1 AND id = $2
       LIMIT 1`,
      [email, id],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    return row ? mapRow(row) : null;
  } catch (error) {
    console.error("Transcripter: could not load job", error);
    return null;
  }
}

export async function saveJob(email: string, job: JobRecord): Promise<{ persisted: boolean; error?: string }> {
  if (!databaseConfigured()) {
    return { persisted: false, error: "No database is configured. Set DATABASE_URL to store jobs on the server." };
  }
  const pool = await readyPool();
  if (!pool) return { persisted: false, error: "The database is not ready." };
  try {
    const config: WorkflowConfig = job.config;
    const crossChecks: SectionCheck[] = job.crossChecks || [];
    await pool.query(
      `INSERT INTO transcripter_jobs (
         id, owner_email, title, kind, status, config, source, source_file_name, stages, batches, result,
         cross_checks, resume_cursor, word_count, error_log, created_at, updated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, COALESCE($16::timestamptz, NOW()), NOW())
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title,
         kind = EXCLUDED.kind,
         status = EXCLUDED.status,
         config = EXCLUDED.config,
         source = EXCLUDED.source,
         source_file_name = EXCLUDED.source_file_name,
         stages = EXCLUDED.stages,
         batches = EXCLUDED.batches,
         result = EXCLUDED.result,
         cross_checks = EXCLUDED.cross_checks,
         resume_cursor = EXCLUDED.resume_cursor,
         word_count = EXCLUDED.word_count,
         error_log = EXCLUDED.error_log,
         updated_at = NOW()
       WHERE transcripter_jobs.owner_email = EXCLUDED.owner_email`,
      [
        job.id,
        email,
        job.title,
        job.kind,
        job.status,
        JSON.stringify(config),
        (job.source || "").slice(0, 2_000_000),
        job.sourceFileName || "",
        JSON.stringify(job.stages || {}),
        JSON.stringify(job.batches || []),
        (job.result || "").slice(0, 2_000_000),
        JSON.stringify(crossChecks.slice(0, 500)),
        job.resumeCursor ? JSON.stringify(job.resumeCursor) : null,
        job.wordCount || 0,
        JSON.stringify((job.errorLog || []).slice(-80)),
        job.createdAt || null,
      ],
    );
    return { persisted: true };
  } catch (error) {
    console.error("Transcripter: could not save job", error);
    return { persisted: false, error: describeDatabaseError(error) };
  }
}

export async function deleteJob(email: string, id: string): Promise<{ persisted: boolean; error?: string }> {
  if (!databaseConfigured()) return { persisted: false, error: "No database is configured." };
  const pool = await readyPool();
  if (!pool) return { persisted: false, error: "The database is not ready." };
  try {
    await pool.query("DELETE FROM transcripter_jobs WHERE owner_email = $1 AND id = $2", [email, id]);
    return { persisted: true };
  } catch (error) {
    return { persisted: false, error: describeDatabaseError(error) };
  }
}
