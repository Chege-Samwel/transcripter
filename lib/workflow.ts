export type StageKey = "normalize" | "format" | "edit";
export type TraceStatus = "queued" | "running" | "success" | "error";

export type WorkflowConfig = {
  name: string;
  description: string;
  transcript: string;
  sourceFileName: string;
  formatRules: string;
  editRules: string;
  masterPrompt: string;
  primaryModel: string;
  fallbackModels: string[];
  contextWindow: number;
  batchTokens: number;
  overlapTokens: number;
  maxOutputTokens: number;
  temperature: number;
};

export type SectionCheck = {
  section: number;
  status: "pass" | "review";
  score: number;
  note: string;
  flags: string[];
};

export type TraceEvent = {
  id: string;
  stage: string;
  label: string;
  status: TraceStatus;
  batch?: number;
  total?: number;
  model?: string;
  duration?: number;
  message?: string;
  timestamp: string;
  demo?: boolean;
};

export type Progress = {
  stage: StageKey | "idle";
  stageIndex: number;
  batch: number;
  total: number;
};

export const MAX_ALTERNATIVES = 8;

export const PIPELINE: { key: StageKey; label: string; description: string }[] = [
  { key: "normalize", label: "Normalize", description: "Clean source signals" },
  { key: "format", label: "Format", description: "Apply structure" },
  { key: "edit", label: "Edit", description: "Polish with restraint" },
];

export const MODEL_OPTIONS = [
  "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
  "nvidia/llama-3.1-nemotron-4b-instruct",
  "meta/llama-3.1-70b-instruct",
  "meta/llama-3.1-8b-instruct",
];

export const DEFAULT_CONFIG: WorkflowConfig = {
  name: "Transcript edit",
  description: "",
  transcript: "",
  sourceFileName: "",
  formatRules: `Use consistent speaker labels and natural paragraph breaks.
Keep the source chronological. Do not summarize or add headings that are not present in the source.`,
  editRules: `Improve grammar and remove accidental repetition without flattening the speaker's voice.
Remove filler only when it does not carry meaning.
Preserve names, numbers, dates, claims, uncertainty markers, and speaker intent.`,
  masterPrompt: `You are a meticulous transcript editor working in controlled passes. Preserve meaning before style. Never invent a word that is not supported by the source, never merge speakers, and never silently resolve an uncertain phrase. Return only the requested transformation for the supplied batch.`,
  primaryModel: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  fallbackModels: ["nvidia/llama-3.1-nemotron-nano-vl-8b-v1", "meta/llama-3.1-70b-instruct"],
  contextWindow: 32768,
  batchTokens: 4500,
  overlapTokens: 180,
  maxOutputTokens: 4000,
  temperature: 0.2,
};

export function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function estimateTokens(text: string) {
  return Math.ceil((text || "").length / 4);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeConfig(value: unknown): WorkflowConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_CONFIG, fallbackModels: [...DEFAULT_CONFIG.fallbackModels] };
  const candidate = value as Partial<WorkflowConfig>;
  const fallbackModels = Array.isArray(candidate.fallbackModels)
    ? candidate.fallbackModels.filter((model): model is string => typeof model === "string").slice(0, MAX_ALTERNATIVES)
    : [...DEFAULT_CONFIG.fallbackModels];
  return {
    ...DEFAULT_CONFIG,
    ...candidate,
    name: typeof candidate.name === "string" ? candidate.name : DEFAULT_CONFIG.name,
    description: typeof candidate.description === "string" ? candidate.description : DEFAULT_CONFIG.description,
    transcript: typeof candidate.transcript === "string" ? candidate.transcript : DEFAULT_CONFIG.transcript,
    sourceFileName: typeof candidate.sourceFileName === "string" ? candidate.sourceFileName : DEFAULT_CONFIG.sourceFileName,
    formatRules: typeof candidate.formatRules === "string" ? candidate.formatRules : DEFAULT_CONFIG.formatRules,
    editRules: typeof candidate.editRules === "string" ? candidate.editRules : DEFAULT_CONFIG.editRules,
    masterPrompt: typeof candidate.masterPrompt === "string" ? candidate.masterPrompt : DEFAULT_CONFIG.masterPrompt,
    primaryModel: typeof candidate.primaryModel === "string" ? candidate.primaryModel : DEFAULT_CONFIG.primaryModel,
    fallbackModels,
    contextWindow: Number(candidate.contextWindow) || DEFAULT_CONFIG.contextWindow,
    batchTokens: Number(candidate.batchTokens) || DEFAULT_CONFIG.batchTokens,
    overlapTokens: Number(candidate.overlapTokens) || DEFAULT_CONFIG.overlapTokens,
    maxOutputTokens: Number(candidate.maxOutputTokens) || DEFAULT_CONFIG.maxOutputTokens,
    temperature: typeof candidate.temperature === "number" && Number.isFinite(candidate.temperature) ? clamp(candidate.temperature, 0, 1) : DEFAULT_CONFIG.temperature,
  };
}

function splitLongUnit(unit: string, maxChars: number) {
  if (unit.length <= maxChars) return [unit.trim()];
  const sentences = unit.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) {
    const words = unit.split(/\s+/);
    const pieces: string[] = [];
    let current = "";
    words.forEach((word) => {
      if (current && current.length + word.length + 1 > maxChars) {
        pieces.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    });
    if (current) pieces.push(current);
    return pieces;
  }
  const pieces: string[] = [];
  let current = "";
  sentences.forEach((sentence) => {
    if (current && current.length + sentence.length + 1 > maxChars) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  });
  if (current) pieces.push(current);
  return pieces;
}

export function chunkTranscript(text: string, targetTokens: number) {
  const maxChars = Math.max(1600, Math.round(targetTokens * 4));
  const units = (text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((unit) => unit.trim())
    .filter(Boolean)
    .flatMap((unit) => splitLongUnit(unit, maxChars));
  const batches: string[] = [];
  let current = "";
  units.forEach((unit) => {
    if (current && current.length + unit.length + 2 > maxChars) {
      batches.push(current.trim());
      current = unit;
    } else {
      current = current ? `${current}\n\n${unit}` : unit;
    }
  });
  if (current.trim()) batches.push(current.trim());
  return batches.length ? batches : [];
}

export function sectionChecks(text: string): SectionCheck[] {
  const sections = (text || "")
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);
  return sections.map((section, index) => {
    const flags: string[] = [];
    if (/\[(?:inaudible|crosstalk|unintelligible|unknown)\]|\bTODO\b|\?{3,}/i.test(section)) flags.push("Unresolved transcript marker");
    if (/\b(\w+)\s+\1\b/i.test(section)) flags.push("Repeated word");
    if (section.length > 300 && !/[.!?…]["')\]]?$/.test(section)) flags.push("Long sentence needs a punctuation review");
    if (section.length > 40 && !/[.!?…"')\]]$/.test(section)) flags.push("Check ending punctuation");
    return {
      section: index + 1,
      status: flags.length ? "review" : "pass",
      score: Math.max(0, 100 - flags.length * 22),
      note: flags.length ? flags.join(" · ") : "Structure and transcript markers look clean",
      flags,
    };
  });
}

export function slugify(value: string) {
  return (value || "transcript-edit").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "transcript-edit";
}

export function shortModel(value = "") {
  return value.replace(/^nvidia\//, "").replace(/^meta\//, "");
}
