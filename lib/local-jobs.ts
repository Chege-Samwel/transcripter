import { parseJobRecord, type JobRecord } from "./types";

const LIST_KEY = "transcripter-jobs-v1";
const DRAFT_KEY = "transcripter-draft-v1";

export function readLocalJobs(): JobRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(LIST_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => parseJobRecord(item)).filter((item): item is JobRecord => Boolean(item));
  } catch {
    return [];
  }
}

export function writeLocalJobs(jobs: JobRecord[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(LIST_KEY, JSON.stringify(jobs.slice(0, 80)));
  } catch {
    /* quota — the active job still lives in memory */
  }
}

export function upsertLocalJob(job: JobRecord) {
  const next = { ...job, updatedAt: new Date().toISOString() };
  writeLocalJobs([next, ...readLocalJobs().filter((item) => item.id !== job.id)]);
  return next;
}

export function removeLocalJob(id: string) {
  writeLocalJobs(readLocalJobs().filter((item) => item.id !== id));
}

export function readLocalJob(id: string) {
  return readLocalJobs().find((item) => item.id === id) || null;
}

export type DraftPayload = {
  source: string;
  sourceFileName: string;
  kind: "demo" | "job";
  formatRules?: string;
  editRules?: string;
  masterPrompt?: string;
};

export function readDraft(): DraftPayload | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DraftPayload;
    if (!parsed || typeof parsed.source !== "string") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeDraft(draft: DraftPayload) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function clearDraft() {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
