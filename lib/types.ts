import { DEFAULT_CONFIG, makeId, normalizeConfig, type SectionCheck, type WorkflowConfig } from "./workflow";
import { countWords } from "./limits";

export type UserStatus = "awaiting_approval" | "approved" | "suspended";
export type UserRole = "editor" | "admin";
export type JobKind = "demo" | "job";
export type JobStatus = "draft" | "running" | "paused" | "complete" | "failed";
export type Persistence = "database" | "browser";

export type Account = {
  email: string;
  displayName: string;
  status: UserStatus;
  role: UserRole;
  canBookJob: boolean;
  demoWordCap: number;
  persistence: Persistence;
};

export type JobBatch = {
  index: number;
  source: string;
  normalize: string;
  format: string;
  edit: string;
};

export type JobStages = {
  normalize: string;
  format: string;
  edit: string;
  refine: string;
};

export type ResumeCursor = {
  batchIndex: number;
  stageIndex: number;
  continuity: string;
};

export type ErrorEvent = {
  id: string;
  timestamp: string;
  stage: string;
  batch?: number;
  total?: number;
  code?: string;
  message: string;
  retryable: boolean;
};

export type JobRecord = {
  id: string;
  ownerEmail: string;
  title: string;
  kind: JobKind;
  status: JobStatus;
  config: WorkflowConfig;
  source: string;
  sourceFileName: string;
  stages: JobStages;
  batches: JobBatch[];
  result: string;
  crossChecks: SectionCheck[];
  resumeCursor: ResumeCursor | null;
  wordCount: number;
  errorLog: ErrorEvent[];
  modelUsed?: string;
  createdAt: string;
  updatedAt: string;
};

export function emptyStages(): JobStages {
  return { normalize: "", format: "", edit: "", refine: "" };
}

export function jobTitleFromSource(source: string, fileName = "") {
  const fromFile = fileName.replace(/\s+→\s+.*$/, "").replace(/\.[^.]+$/, "").trim();
  if (fromFile && fromFile.toLowerCase() !== "untitled source") return fromFile.slice(0, 80);
  const line = (source || "")
    .split("\n")
    .map((entry) => entry.trim())
    .find(Boolean);
  return line ? line.slice(0, 80) : "Untitled transcript";
}

export function createJobRecord(input: {
  ownerEmail: string;
  kind: JobKind;
  config?: unknown;
  source?: string;
  sourceFileName?: string;
  title?: string;
  id?: string;
}): JobRecord {
  const now = new Date().toISOString();
  const source = input.source || "";
  return {
    id: input.id || makeId(),
    ownerEmail: input.ownerEmail,
    title: input.title || jobTitleFromSource(source, input.sourceFileName || ""),
    kind: input.kind,
    status: "draft",
    config: normalizeConfig(input.config || { ...DEFAULT_CONFIG, transcript: source, sourceFileName: input.sourceFileName || "" }),
    source,
    sourceFileName: input.sourceFileName || "",
    stages: emptyStages(),
    batches: [],
    result: "",
    crossChecks: [],
    resumeCursor: null,
    wordCount: countWords(source),
    errorLog: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function parseJobRecord(value: unknown): JobRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<JobRecord> & { owner_email?: string; source_file_name?: string };
  const id = typeof candidate.id === "string" && candidate.id ? candidate.id : "";
  if (!id) return null;
  const ownerEmail = typeof candidate.ownerEmail === "string" ? candidate.ownerEmail : typeof candidate.owner_email === "string" ? candidate.owner_email : "";
  const source = typeof candidate.source === "string" ? candidate.source : "";
  const stages = candidate.stages && typeof candidate.stages === "object" ? candidate.stages : emptyStages();
  return {
    id,
    ownerEmail,
    title: typeof candidate.title === "string" && candidate.title ? candidate.title : jobTitleFromSource(source, candidate.sourceFileName || ""),
    kind: candidate.kind === "job" ? "job" : "demo",
    status: ["draft", "running", "paused", "complete", "failed"].includes(candidate.status as string) ? (candidate.status as JobStatus) : "draft",
    config: normalizeConfig(candidate.config),
    source,
    sourceFileName: typeof candidate.sourceFileName === "string" ? candidate.sourceFileName : typeof candidate.source_file_name === "string" ? candidate.source_file_name : "",
    stages: {
      normalize: typeof stages.normalize === "string" ? stages.normalize : "",
      format: typeof stages.format === "string" ? stages.format : "",
      edit: typeof stages.edit === "string" ? stages.edit : "",
      refine: typeof stages.refine === "string" ? stages.refine : "",
    },
    batches: Array.isArray(candidate.batches) ? candidate.batches.filter((batch): batch is JobBatch => Boolean(batch && typeof batch === "object")) : [],
    result: typeof candidate.result === "string" ? candidate.result : "",
    crossChecks: Array.isArray(candidate.crossChecks) ? candidate.crossChecks : [],
    resumeCursor: candidate.resumeCursor && typeof candidate.resumeCursor === "object" ? candidate.resumeCursor : null,
    wordCount: Number(candidate.wordCount) || countWords(source),
    errorLog: Array.isArray(candidate.errorLog) ? candidate.errorLog : [],
    modelUsed: typeof candidate.modelUsed === "string" ? candidate.modelUsed : undefined,
    createdAt: typeof candidate.createdAt === "string" ? candidate.createdAt : new Date().toISOString(),
    updatedAt: typeof candidate.updatedAt === "string" ? candidate.updatedAt : new Date().toISOString(),
  };
}
