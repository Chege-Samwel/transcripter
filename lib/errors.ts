import { databaseConfigured, getPool } from "./database";
import { databaseReadiness } from "./migrate";
import { makeId } from "./workflow";

export type LoggedError = {
  ownerEmail: string;
  jobId?: string;
  stage?: string;
  batch?: number;
  code?: string;
  message: string;
  detail?: unknown;
};

export async function logError(event: LoggedError) {
  console.error("Transcripter error", {
    ownerEmail: event.ownerEmail,
    jobId: event.jobId,
    stage: event.stage,
    batch: event.batch,
    code: event.code,
    message: event.message,
  });
  if (!databaseConfigured()) return;
  try {
    const readiness = await databaseReadiness();
    if (readiness.error) return;
    await getPool().query(
      `INSERT INTO transcripter_error_events (id, owner_email, job_id, stage, batch, code, message, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        makeId(),
        event.ownerEmail,
        event.jobId || null,
        event.stage || null,
        typeof event.batch === "number" ? event.batch : null,
        event.code || null,
        event.message.slice(0, 2000),
        JSON.stringify(event.detail || {}),
      ],
    );
  } catch (error) {
    console.error("Transcripter: could not persist error event", error);
  }
}
