'use client';

import JSZip from "jszip";
import { jsPDF } from "jspdf";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

type View = "workspace" | "trace" | "output";
type StageKey = "normalize" | "format" | "edit";
type TraceStatus = "queued" | "running" | "success" | "error";

type WorkflowConfig = {
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

type TraceEvent = {
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

type Progress = {
  stage: StageKey | "idle";
  stageIndex: number;
  batch: number;
  total: number;
};

type SectionCheck = {
  section: number;
  status: "pass" | "review";
  score: number;
  note: string;
  flags: string[];
};

type Notice = {
  tone: "success" | "error" | "info";
  message: string;
};

const STORAGE_KEY = "transcripter-workflow-v1";
const WORKFLOW_FILE_TYPE = "transcripter-workflow";

const DEFAULT_CONFIG: WorkflowConfig = {
  name: "Product interview / clean edit",
  description: "A repeatable transcript pass that preserves voice while making the final copy publish-ready.",
  transcript: `HOST: Today we're talking about the new launch. Um, the thing we kept hearing from customers was that the first five minutes felt a little confusing.

GUEST: Right. And, you know, once we watched people use it, the pattern was pretty clear. They wanted a faster path to the one action they came to complete.

HOST: So the edit should keep the conversation natural, but make the sequence easy to follow. The numbers and the speaker's wording are important here.`,
  sourceFileName: "starter-transcript.txt",
  formatRules: `Use uppercase speaker labels followed by a colon.
Keep natural paragraph breaks. Keep the interview in chronological order.
Do not turn the transcript into a summary or add section headings unless they already exist.`,
  editRules: `Polish grammar and remove accidental repetition without flattening the speaker's voice.
Remove filler words only when they do not carry meaning.
Preserve names, numbers, dates, claims, uncertainty markers, and the intent of every speaker.`,
  masterPrompt: `You are a meticulous transcript editor working in controlled passes. Preserve meaning before style. Never invent a word that is not supported by the source, never merge speakers, and never silently resolve an uncertain phrase. Return only the requested transformation for the supplied batch.`,
  primaryModel: "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  fallbackModels: ["nvidia/llama-3.1-nemotron-nano-vl-8b-v1", "meta/llama-3.1-70b-instruct"],
  contextWindow: 32768,
  batchTokens: 4500,
  overlapTokens: 180,
  maxOutputTokens: 4000,
  temperature: 0.2,
};

const PIPELINE: { key: StageKey; number: string; label: string; description: string }[] = [
  { key: "normalize", number: "01", label: "Normalize", description: "Clean the source" },
  { key: "format", number: "02", label: "Format", description: "Apply the contract" },
  { key: "edit", number: "03", label: "Edit", description: "Polish, preserve voice" },
];

const MODEL_OPTIONS = [
  "nvidia/llama-3.1-nemotron-ultra-253b-v1",
  "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
  "nvidia/llama-3.1-nemotron-4b-instruct",
  "meta/llama-3.1-70b-instruct",
  "meta/llama-3.1-8b-instruct",
];

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    xmlns: "http://www.w3.org/2000/svg",
    "aria-hidden": true,
  } as const;

  const stroke = {
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (name) {
    case "spark":
      return <svg {...common}><path {...stroke} d="m12 2 1.65 6.35L20 10l-6.35 1.65L12 18l-1.65-6.35L4 10l6.35-1.65L12 2Z" /><path {...stroke} d="m19 16 .7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z" /></svg>;
    case "source":
      return <svg {...common}><path {...stroke} d="M6.5 3.5h8l3 3v14h-11v-17Z" /><path {...stroke} d="M14.5 3.5v4h3M9 12h6M9 15.5h6M9 8.5h2" /></svg>;
    case "sliders":
      return <svg {...common}><path {...stroke} d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="currentColor" /><circle cx="15" cy="12" r="2" fill="currentColor" /><circle cx="8" cy="18" r="2" fill="currentColor" /></svg>;
    case "play":
      return <svg {...common}><path d="M8 5.5v13l10-6.5-10-6.5Z" fill="currentColor" /></svg>;
    case "activity":
      return <svg {...common}><path {...stroke} d="M3 12h4l2.1-6 4.2 12 2.1-6H21" /></svg>;
    case "file":
      return <svg {...common}><path {...stroke} d="M6.5 3.5h8l3 3v14h-11v-17Z" /><path {...stroke} d="M14.5 3.5v4h3" /></svg>;
    case "upload":
      return <svg {...common}><path {...stroke} d="M12 16V4M8 8l4-4 4 4M5 14v5h14v-5" /></svg>;
    case "download":
      return <svg {...common}><path {...stroke} d="M12 4v12M8 12l4 4 4-4M5 20h14" /></svg>;
    case "share":
      return <svg {...common}><circle cx="18" cy="5" r="2.4" {...stroke} /><circle cx="6" cy="12" r="2.4" {...stroke} /><circle cx="18" cy="19" r="2.4" {...stroke} /><path {...stroke} d="m8.2 10.8 7.5-4.3M8.2 13.2l7.5 4.3" /></svg>;
    case "copy":
      return <svg {...common}><rect {...stroke} x="8" y="8" width="11" height="12" rx="1.5" /><path {...stroke} d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H8" /></svg>;
    case "chevron":
      return <svg {...common}><path {...stroke} d="m9 6 6 6-6 6" /></svg>;
    case "check":
      return <svg {...common}><path {...stroke} d="m5 12 4 4L19 6" /></svg>;
    case "alert":
      return <svg {...common}><path {...stroke} d="M12 4 21 20H3L12 4Z" /><path {...stroke} d="M12 9v5M12 17.5h.01" /></svg>;
    case "clock":
      return <svg {...common}><circle {...stroke} cx="12" cy="12" r="8.5" /><path {...stroke} d="M12 7v5l3.5 2" /></svg>;
    case "lock":
      return <svg {...common}><rect {...stroke} x="5" y="10" width="14" height="10" rx="2" /><path {...stroke} d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
    case "layers":
      return <svg {...common}><path {...stroke} d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" /><path {...stroke} d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" /></svg>;
    case "eye":
      return <svg {...common}><path {...stroke} d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" /><circle {...stroke} cx="12" cy="12" r="2" /></svg>;
    case "refresh":
      return <svg {...common}><path {...stroke} d="M20 11a8 8 0 0 0-14.5-4.7L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.7L20 16m0 4v-4h-4" /></svg>;
    case "settings":
      return <svg {...common}><path {...stroke} d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path {...stroke} d="m19.4 15 .1.1a1.7 1.7 0 0 1-2.4 2.4l-.1-.1a1.7 1.7 0 0 0-2.9 1.2v.2a1.7 1.7 0 0 1-3.4 0v-.2a1.7 1.7 0 0 0-2.9-1.2l-.1.1a1.7 1.7 0 0 1-2.4-2.4l.1-.1A1.7 1.7 0 0 0 6.2 12a1.7 1.7 0 0 0-1.8-1.7 1.7 1.7 0 0 1 0-3.4h.2A1.7 1.7 0 0 0 5.8 4l-.1-.1a1.7 1.7 0 0 1 2.4-2.4l.1.1A1.7 1.7 0 0 0 11.1.4h.2a1.7 1.7 0 0 1 3.4 0v.2A1.7 1.7 0 0 0 17.6 2l.1-.1a1.7 1.7 0 0 1 2.4 2.4l-.1.1A1.7 1.7 0 0 0 21.2 7h.2a1.7 1.7 0 0 1 0 3.4h-.2a1.7 1.7 0 0 0-1.8 1.7 1.7 1.7 0 0 0 0 2.9Z" /></svg>;
    case "external":
      return <svg {...common}><path {...stroke} d="M14 5h5v5M19 5l-8 8" /><path {...stroke} d="M19 13v5.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5H11" /></svg>;
    case "x":
      return <svg {...common}><path {...stroke} d="m6 6 12 12M18 6 6 18" /></svg>;
    case "plus":
      return <svg {...common}><path {...stroke} d="M12 5v14M5 12h14" /></svg>;
    default:
      return <svg {...common}><circle {...stroke} cx="12" cy="12" r="8" /></svg>;
  }
}

function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function estimateTokens(text: string) {
  return Math.ceil(text.length / 4);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeConfig(value: unknown): WorkflowConfig {
  if (!value || typeof value !== "object") return { ...DEFAULT_CONFIG, fallbackModels: [...DEFAULT_CONFIG.fallbackModels] };
  const candidate = value as Partial<WorkflowConfig>;
  const fallbackModels = Array.isArray(candidate.fallbackModels)
    ? candidate.fallbackModels.filter((model): model is string => typeof model === "string").slice(0, 3)
    : DEFAULT_CONFIG.fallbackModels;
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
    fallbackModels: fallbackModels.length ? fallbackModels : [""],
    contextWindow: Number(candidate.contextWindow) || DEFAULT_CONFIG.contextWindow,
    batchTokens: Number(candidate.batchTokens) || DEFAULT_CONFIG.batchTokens,
    overlapTokens: Number(candidate.overlapTokens) || DEFAULT_CONFIG.overlapTokens,
    maxOutputTokens: Number(candidate.maxOutputTokens) || DEFAULT_CONFIG.maxOutputTokens,
    temperature: typeof candidate.temperature === "number" ? candidate.temperature : DEFAULT_CONFIG.temperature,
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

function chunkTranscript(text: string, targetTokens: number) {
  const maxChars = Math.max(1600, Math.round(targetTokens * 4));
  const units = text
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
  return batches.length ? batches : [text.trim()];
}

function sectionChecks(text: string): SectionCheck[] {
  const sections = text
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);
  return sections.map((section, index) => {
    const flags: string[] = [];
    if (/\[(?:inaudible|crosstalk|unintelligible|unknown)\]|\bTODO\b|\?{3,}/i.test(section)) {
      flags.push("Unresolved transcript marker");
    }
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

function slugify(value: string) {
  return (value || "transcripter-workflow").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "transcripter-workflow";
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function encodeShared(value: unknown) {
  const json = JSON.stringify(value);
  return btoa(unescape(encodeURIComponent(json))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeShared(value: string) {
  try {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
    return JSON.parse(decodeURIComponent(escape(atob(padded))));
  } catch {
    return null;
  }
}

function shortModel(value = "") {
  return value.replace(/^nvidia\//, "").replace(/^meta\//, "");
}

function timeLabel(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function Home() {
  const [config, setConfig] = useState<WorkflowConfig>(() => ({ ...DEFAULT_CONFIG, fallbackModels: [...DEFAULT_CONFIG.fallbackModels] }));
  const [activeView, setActiveView] = useState<View>("workspace");
  const [result, setResult] = useState("");
  const [crossChecks, setCrossChecks] = useState<SectionCheck[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [progress, setProgress] = useState<Progress>({ stage: "idle", stageIndex: -1, batch: 0, total: 0 });
  const [isRunning, setIsRunning] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState("");
  const transcriptInputRef = useRef<HTMLInputElement>(null);
  const workflowInputRef = useRef<HTMLInputElement>(null);

  const batches = useMemo(() => chunkTranscript(config.transcript, config.batchTokens), [config.transcript, config.batchTokens]);
  const sourceTokens = useMemo(() => estimateTokens(config.transcript), [config.transcript]);
  const outputTokens = useMemo(() => estimateTokens(result), [result]);
  const progressPercent = useMemo(() => {
    if (progress.total && progress.stage !== "idle") {
      const completed = progress.batch * PIPELINE.length + Math.max(0, progress.stageIndex);
      return clamp(Math.round((completed / (progress.total * PIPELINE.length)) * 100), 3, 99);
    }
    return result ? 100 : 0;
  }, [progress, result]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const shared = new URLSearchParams(window.location.search).get("workflow");
      const sharedPayload = shared ? decodeShared(shared) : null;
      const payload = sharedPayload || (stored ? JSON.parse(stored) : null);
      if (payload) {
        const incomingConfig = payload.config || payload.workflow || payload;
        setConfig(normalizeConfig(incomingConfig));
        if (typeof payload.result === "string") setResult(payload.result);
        if (Array.isArray(payload.crossChecks)) setCrossChecks(payload.crossChecks);
        if (sharedPayload) {
          setNotice({ tone: "success", message: "Shared workflow loaded. Every field is editable and already filled in." });
          window.history.replaceState({}, "", window.location.pathname);
        }
      }
    } catch {
      setNotice({ tone: "info", message: "A fresh workflow was opened because the saved draft could not be read." });
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ type: WORKFLOW_FILE_TYPE, version: 1, config, result, crossChecks }));
    } catch {
      setNotice({ tone: "info", message: "This draft is too large for browser storage. Export the workflow to keep a copy." });
    }
  }, [config, result, crossChecks, hydrated]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const updateConfig = useCallback(<K extends keyof WorkflowConfig>(key: K, value: WorkflowConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  }, []);

  const updateFallback = useCallback((index: number, value: string) => {
    setConfig((current) => {
      const fallbackModels = [...current.fallbackModels];
      while (fallbackModels.length <= index) fallbackModels.push("");
      fallbackModels[index] = value;
      return { ...current, fallbackModels };
    });
  }, []);

  const addTrace = useCallback((event: Omit<TraceEvent, "id" | "timestamp">) => {
    setTrace((current) => [{ ...event, id: makeId(), timestamp: new Date().toISOString() }, ...current]);
  }, []);

  const updateTrace = useCallback((id: string, patch: Partial<TraceEvent>) => {
    setTrace((current) => current.map((event) => (event.id === id ? { ...event, ...patch } : event)));
  }, []);

  const readTranscriptFile = useCallback(async (file: File) => {
    const isZip = file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
    if (!isZip) {
      return { text: await file.text(), sourceName: file.name };
    }
    const zip = await JSZip.loadAsync(file);
    const names = Object.keys(zip.files);
    const exact = names.find((name) => !zip.files[name].dir && name.split("/").pop()?.toLowerCase() === "v.txt");
    const fallback = names.find((name) => !zip.files[name].dir && /\.(txt|md|markdown)$/i.test(name));
    const entryName = exact || fallback;
    if (!entryName) throw new Error("That ZIP does not contain V.txt or a text/markdown file.");
    const entry = zip.file(entryName);
    if (!entry) throw new Error("The transcript file inside the ZIP could not be opened.");
    return { text: await entry.async("text"), sourceName: `${file.name} → ${entryName}` };
  }, []);

  const handleTranscriptFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      const loaded = await readTranscriptFile(file);
      updateConfig("transcript", loaded.text);
      updateConfig("sourceFileName", loaded.sourceName);
      setError("");
      addTrace({ stage: "intake", label: "Source loaded", status: "success", message: `${loaded.sourceName} · ${formatNumber(estimateTokens(loaded.text))} estimated tokens` });
      setNotice({ tone: "success", message: `${loaded.sourceName} is ready. The transcript was stored in this workflow.` });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not read that transcript file.";
      setError(message);
      setNotice({ tone: "error", message });
    }
  }, [addTrace, readTranscriptFile, updateConfig]);

  const handleTranscriptInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    void handleTranscriptFile(event.target.files?.[0]);
    event.target.value = "";
  }, [handleTranscriptFile]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void handleTranscriptFile(event.dataTransfer.files?.[0]);
  }, [handleTranscriptFile]);

  const exportWorkflow = useCallback(() => {
    const payload = {
      type: WORKFLOW_FILE_TYPE,
      version: 1,
      exportedAt: new Date().toISOString(),
      config,
      result,
      crossChecks,
    };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }), `${slugify(config.name)}.workflow.json`);
    setNotice({ tone: "success", message: "Workflow downloaded with transcript, rules, routing, and latest output." });
  }, [config, crossChecks, result]);

  const handleWorkflowInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    file.text().then((raw) => {
      try {
        const payload = JSON.parse(raw) as { config?: unknown; result?: string; crossChecks?: SectionCheck[] };
        setConfig(normalizeConfig(payload.config || payload));
        setResult(typeof payload.result === "string" ? payload.result : "");
        setCrossChecks(Array.isArray(payload.crossChecks) ? payload.crossChecks : []);
        setTrace([]);
        setError("");
        setNotice({ tone: "success", message: "Workflow imported. The saved fields are now active; nothing needs to be re-entered." });
      } catch {
        setNotice({ tone: "error", message: "That file is not a valid Transcripter workflow JSON." });
      }
    }).catch(() => setNotice({ tone: "error", message: "The workflow file could not be read." }));
  }, []);

  const copyShareLink = useCallback(async () => {
    const payload = { type: WORKFLOW_FILE_TYPE, version: 1, config, result, crossChecks };
    const encoded = encodeShared(payload);
    const url = `${window.location.origin}${window.location.pathname}?workflow=${encoded}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ tone: "success", message: encoded.length > 12000 ? "Share link copied. For very long transcripts, the workflow JSON is the safer handoff." : "Share link copied with all workflow fields prefilled." });
    } catch {
      setNotice({ tone: "info", message: "Clipboard access is unavailable. Use Export workflow for a portable file." });
    }
  }, [config, crossChecks, result]);

  const copyOutput = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setNotice({ tone: "success", message: "Edited transcript copied to clipboard." });
    } catch {
      setNotice({ tone: "info", message: "Clipboard access is unavailable. Use Download TXT instead." });
    }
  }, [result]);

  const downloadText = useCallback(() => {
    if (!result) return;
    downloadBlob(new Blob([result], { type: "text/plain;charset=utf-8" }), `${slugify(config.name)}.txt`);
    setNotice({ tone: "success", message: "TXT export downloaded." });
  }, [config.name, result]);

  const downloadPdf = useCallback(() => {
    if (!result) return;
    const document = new jsPDF({ unit: "pt", format: "letter" });
    const margin = 54;
    const pageWidth = document.internal.pageSize.getWidth();
    const pageHeight = document.internal.pageSize.getHeight();
    const maxWidth = pageWidth - margin * 2;
    document.setTextColor(30, 40, 48);
    document.setFont("helvetica", "bold");
    document.setFontSize(16);
    document.text(config.name || "Edited transcript", margin, margin);
    document.setFont("helvetica", "normal");
    document.setFontSize(8);
    document.setTextColor(105, 116, 124);
    document.text(`Generated by Transcripter · ${new Date().toLocaleDateString()}`, margin, margin + 16);
    document.setTextColor(38, 47, 55);
    document.setFontSize(10.5);
    const lines = document.splitTextToSize(result, maxWidth) as string[];
    let y = margin + 48;
    lines.forEach((line) => {
      if (y > pageHeight - margin) {
        document.addPage();
        y = margin;
      }
      document.text(line, margin, y);
      y += 15;
    });
    document.save(`${slugify(config.name)}.pdf`);
    setNotice({ tone: "success", message: "PDF export downloaded." });
  }, [config.name, result]);

  const runWorkflow = useCallback(async () => {
    if (isRunning) return;
    if (!config.transcript.trim()) {
      setError("Add a transcript before running the workflow.");
      setActiveView("workspace");
      return;
    }
    setError("");
    setResult("");
    setCrossChecks([]);
    setTrace([]);
    setIsRunning(true);
    setActiveView("trace");
    const workBatches = chunkTranscript(config.transcript, clamp(Number(config.batchTokens) || 4500, 400, 20000));
    setProgress({ stage: "normalize", stageIndex: 0, batch: 0, total: workBatches.length });
    addTrace({ stage: "planner", label: "Context planner", status: "success", total: workBatches.length, message: `${formatNumber(workBatches.length)} safe batch${workBatches.length === 1 ? "" : "es"} · ${formatNumber(sourceTokens)} estimated input tokens` });
    const outputs: string[] = [];
    let continuity = "";
    const startedAt = Date.now();

    try {
      for (let batchIndex = 0; batchIndex < workBatches.length; batchIndex += 1) {
        let currentText = workBatches[batchIndex];
        for (let stageIndex = 0; stageIndex < PIPELINE.length; stageIndex += 1) {
          const stage = PIPELINE[stageIndex];
          setProgress({ stage: stage.key, stageIndex, batch: batchIndex, total: workBatches.length });
          const traceId = makeId();
          const stageStarted = Date.now();
          setTrace((current) => [{ id: traceId, stage: stage.key, label: stage.label, status: "running", batch: batchIndex + 1, total: workBatches.length, timestamp: new Date().toISOString(), message: "One process, one model call" }, ...current]);
          try {
            const response = await fetch("/api/process", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                stage: stage.key,
                text: currentText,
                masterPrompt: config.masterPrompt,
                formatRules: config.formatRules,
                editRules: config.editRules,
                model: config.primaryModel,
                fallbackModels: config.fallbackModels,
                contextWindow: config.contextWindow,
                maxOutputTokens: config.maxOutputTokens,
                temperature: config.temperature,
                batch: { index: batchIndex, total: workBatches.length },
                contextBefore: continuity,
              }),
            });
            const data = (await response.json()) as { ok?: boolean; output?: string; error?: string; modelUsed?: string; demo?: boolean; warning?: string; attempts?: { model: string; error: string }[] };
            if (!response.ok || !data.ok || !data.output?.trim()) {
              const attempts = data.attempts?.length ? ` ${data.attempts.map((attempt) => `${shortModel(attempt.model)}: ${attempt.error}`).join(" | ")}` : "";
              throw new Error(`${data.error || "This process did not return an output."}${attempts}`);
            }
            currentText = data.output.trim();
            updateTrace(traceId, {
              status: "success",
              duration: Date.now() - stageStarted,
              model: data.modelUsed || config.primaryModel,
              demo: data.demo,
              message: data.warning || (data.modelUsed && data.modelUsed !== config.primaryModel ? `Fallback engaged after primary model error` : "Batch returned successfully"),
            });
          } catch (caught) {
            const message = caught instanceof Error ? caught.message : "The model process failed.";
            updateTrace(traceId, { status: "error", duration: Date.now() - stageStarted, model: config.primaryModel, message });
            throw new Error(`Batch ${batchIndex + 1}, ${stage.label}: ${message}`);
          }
        }
        outputs.push(currentText);
        continuity = currentText.slice(-Math.max(0, config.overlapTokens) * 4);
      }
      const edited = outputs.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
      setResult(edited);
      setProgress({ stage: "idle", stageIndex: PIPELINE.length, batch: workBatches.length, total: workBatches.length });
      addTrace({ stage: "complete", label: "Full edit assembled", status: "success", batch: workBatches.length, total: workBatches.length, duration: Date.now() - startedAt, message: `${formatNumber(estimateTokens(edited))} output tokens · ready for review` });
      setActiveView("output");
      setNotice({ tone: "success", message: `Workflow complete across ${workBatches.length} batch${workBatches.length === 1 ? "" : "es"}.` });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "The workflow stopped unexpectedly.";
      setError(message);
      addTrace({ stage: "workflow", label: "Workflow stopped", status: "error", message: "Fix the issue and run again. Completed batch output was not merged into the final version." });
    } finally {
      setIsRunning(false);
    }
  }, [addTrace, config, isRunning, sourceTokens, updateTrace]);

  const runCrossCheck = useCallback(async () => {
    if (!result || isChecking) return;
    setIsChecking(true);
    setError("");
    setActiveView("output");
    const checkStarted = Date.now();
    addTrace({ stage: "crosscheck", label: "Cross-check queued", status: "running", message: "Scanning each output section against transcript-safe rules" });
    await new Promise((resolve) => window.setTimeout(resolve, 420));
    const checks = sectionChecks(result);
    setCrossChecks(checks);
    const flagged = checks.filter((check) => check.status === "review").length;
    setTrace((current) => current.map((event) => event.label === "Cross-check queued" && event.status === "running" ? { ...event, status: "success", duration: Date.now() - checkStarted, message: flagged ? `${flagged} section${flagged === 1 ? "" : "s"} need review · no text was changed` : "All sections passed the deterministic rule scan", model: "Rule engine" } : event));
    setIsChecking(false);
    setNotice({ tone: flagged ? "info" : "success", message: flagged ? `${flagged} section${flagged === 1 ? "" : "s"} need a human review.` : "Cross-check passed for every section." });
  }, [addTrace, isChecking, result]);

  const statusForStage = (stage: StageKey) => {
    if (isRunning) {
      if (progress.stage === stage) return "active";
      if (progress.stageIndex > PIPELINE.findIndex((item) => item.key === stage)) return "done";
    }
    if (!isRunning && result) return "done";
    return "idle";
  };

  const goTo = (view: View) => {
    setActiveView(view);
    setError("");
  };

  const onModelChange = (key: "primaryModel" | "fallback", index?: number) => (event: ChangeEvent<HTMLInputElement>) => {
    if (key === "primaryModel") updateConfig("primaryModel", event.target.value);
    else updateFallback(index || 0, event.target.value);
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><Icon name="spark" size={19} /></div>
          <div><strong>TRANSCRIPTER</strong><span>WORKFLOW STUDIO</span></div>
        </div>

        <div className="workspace-chip">
          <div className="workspace-chip-icon"><Icon name="layers" size={16} /></div>
          <div className="workspace-chip-copy"><span>ACTIVE WORKFLOW</span><strong>{config.name || "Untitled workflow"}</strong></div>
          <span className="live-dot" />
        </div>

        <nav className="side-nav" aria-label="Workflow navigation">
          <p className="nav-label">BUILD</p>
          <button className={`nav-item ${activeView === "workspace" ? "active" : ""}`} onClick={() => goTo("workspace")}>
            <span className="nav-index">01</span><Icon name="source" size={17} /><span>Source &amp; rules</span><Icon name="chevron" size={14} />
          </button>
          <button className={`nav-item ${activeView === "trace" ? "active" : ""}`} onClick={() => goTo("trace")}>
            <span className="nav-index">02</span><Icon name="activity" size={17} /><span>Run trace</span>{trace.length > 0 && <b className="nav-count">{trace.length}</b>}<Icon name="chevron" size={14} />
          </button>
          <button className={`nav-item ${activeView === "output" ? "active" : ""}`} onClick={() => goTo("output")}>
            <span className="nav-index">03</span><Icon name="eye" size={17} /><span>Review output</span>{result && <span className="nav-check"><Icon name="check" size={12} /></span>}<Icon name="chevron" size={14} />
          </button>
        </nav>

        <div className="side-routing">
          <div className="side-routing-top"><span className="status-dot green" />MODEL ROUTING<span className="route-lock"><Icon name="lock" size={12} /></span></div>
          <strong>{shortModel(config.primaryModel)}</strong>
          <div className="route-line"><span />{config.fallbackModels.filter(Boolean).length} fallback{config.fallbackModels.filter(Boolean).length === 1 ? "" : "s"} armed</div>
          <div className="route-models">{config.fallbackModels.filter(Boolean).slice(0, 2).map((model) => <span key={model}>{shortModel(model)}</span>)}</div>
        </div>

        <div className="side-file-actions">
          <p className="nav-label">WORKFLOW FILE</p>
          <button className="side-action" onClick={exportWorkflow}><Icon name="download" size={16} />Export JSON<Icon name="external" size={13} /></button>
          <button className="side-action" onClick={() => workflowInputRef.current?.click()}><Icon name="upload" size={16} />Import JSON<Icon name="external" size={13} /></button>
          <input ref={workflowInputRef} className="visually-hidden" type="file" accept="application/json,.json" onChange={handleWorkflowInput} />
        </div>

        <div className="side-footer">
          <span className="vercel-badge"><span />VERCEL READY</span>
          <span className="version-label">v1.0 / LOCAL DRAFT</span>
        </div>
      </aside>

      <section className="main-shell">
        <header className="topbar">
          <div className="topbar-path"><span>WORKFLOWS</span><Icon name="chevron" size={13} /><strong>{config.name || "Untitled"}</strong></div>
          <div className="topbar-actions">
            <div className="saved-indicator"><span className="status-dot green" />{hydrated ? "Draft saved" : "Loading draft"}</div>
            <button className="button button-ghost" onClick={exportWorkflow}><Icon name="download" size={16} />Export</button>
            <button className="button button-primary" onClick={copyShareLink}><Icon name="share" size={16} />Share workflow</button>
          </div>
        </header>

        <div className="content-wrap">
          <div className="hero-row">
            <div className="hero-copy">
              <p className="eyebrow"><span className="eyebrow-line" />TRANSCRIPT WORKFLOW <span>/</span> {activeView === "workspace" ? "CONFIGURE" : activeView === "trace" ? "LIVE TRACE" : "FINAL REVIEW"}</p>
              <h1>{config.name || "Untitled workflow"}</h1>
              <p>{config.description || "A reusable, batch-safe editorial workflow."}</p>
            </div>
            <div className={`hero-state ${isRunning ? "running" : result ? "complete" : "ready"}`}>
              <div className="hero-state-icon"><Icon name={isRunning ? "activity" : result ? "check" : "spark"} size={18} /></div>
              <div><span>{isRunning ? "PROCESSING" : result ? "READY FOR REVIEW" : "READY TO RUN"}</span><strong>{isRunning ? `${progressPercent}% · batch ${progress.batch + 1}/${progress.total}` : result ? "Pipeline complete" : "NVIDIA route armed"}</strong></div>
            </div>
          </div>

          <div className="metric-strip">
            <div className="metric"><span className="metric-icon cyan"><Icon name="file" size={16} /></span><div><span>SOURCE TOKENS</span><strong>{formatNumber(sourceTokens)}</strong></div></div>
            <div className="metric"><span className="metric-icon lime"><Icon name="layers" size={16} /></span><div><span>SAFE BATCHES</span><strong>{formatNumber(batches.length)}</strong></div></div>
            <div className="metric"><span className="metric-icon amber"><Icon name="settings" size={16} /></span><div><span>CONTEXT WINDOW</span><strong>{formatNumber(config.contextWindow)}</strong></div></div>
            <div className="metric metric-route"><span className="metric-icon violet"><Icon name="activity" size={16} /></span><div><span>PRIMARY ROUTE</span><strong>{shortModel(config.primaryModel)}</strong></div><span className="metric-route-tail"><span className="status-dot green" />fallbacks</span></div>
          </div>

          <div className="pipeline-strip">
            <div className="pipeline-title"><span>PIPELINE</span><strong>One process per call</strong></div>
            <div className="pipeline-track">
              {PIPELINE.map((stage, index) => {
                const status = statusForStage(stage.key);
                return <div className="pipeline-step-wrap" key={stage.key}>
                  <div className={`pipeline-step ${status}`}><span className="pipeline-number">{stage.number}</span><div><strong>{stage.label}</strong><span>{stage.description}</span></div>{status === "done" && <Icon name="check" size={15} />}{status === "active" && <span className="pulse-dot" />}</div>
                  {index < PIPELINE.length - 1 && <span className={`pipeline-connector ${status === "done" ? "done" : ""}`} />}
                </div>;
              })}
              <div className="pipeline-end"><span className="pipeline-end-dot" /><div><strong>Review</strong><span>Human cross-check</span></div></div>
            </div>
          </div>

          {notice && <div className={`notice ${notice.tone}`}><Icon name={notice.tone === "error" ? "alert" : notice.tone === "success" ? "check" : "spark"} size={16} /><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Dismiss notification"><Icon name="x" size={15} /></button></div>}
          {error && <div className="error-banner"><Icon name="alert" size={18} /><div><strong>Workflow needs attention</strong><span>{error}</span></div><button className="button button-small" onClick={() => setActiveView("trace")}>Open trace</button></div>}

          {activeView === "workspace" && <WorkspaceView
            config={config}
            batches={batches}
            sourceTokens={sourceTokens}
            isRunning={isRunning}
            transcriptInputRef={transcriptInputRef}
            onTranscriptInput={handleTranscriptInput}
            onDrop={handleDrop}
            onDragOver={(event) => event.preventDefault()}
            updateConfig={updateConfig}
            updateFallback={updateFallback}
            runWorkflow={runWorkflow}
            onModelChange={onModelChange}
          />}

          {activeView === "trace" && <TraceView
            trace={trace}
            progress={progress}
            progressPercent={progressPercent}
            isRunning={isRunning}
            result={result}
            runWorkflow={runWorkflow}
            sourceTokens={sourceTokens}
            batchCount={batches.length}
          />}

          {activeView === "output" && <OutputView
            result={result}
            outputTokens={outputTokens}
            crossChecks={crossChecks}
            isChecking={isChecking}
            downloadText={downloadText}
            downloadPdf={downloadPdf}
            copyOutput={copyOutput}
            runCrossCheck={runCrossCheck}
            goToWorkspace={() => goTo("workspace")}
          />}

          <footer className="content-footer"><span><span className="footer-dot" />Client draft storage on</span><span>API keys stay server-side on Vercel</span><span>Context-aware batch planner</span></footer>
        </div>
      </section>
    </main>
  );
}

type WorkspaceProps = {
  config: WorkflowConfig;
  batches: string[];
  sourceTokens: number;
  isRunning: boolean;
  transcriptInputRef: React.RefObject<HTMLInputElement>;
  onTranscriptInput: (event: ChangeEvent<HTMLInputElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  updateConfig: <K extends keyof WorkflowConfig>(key: K, value: WorkflowConfig[K]) => void;
  updateFallback: (index: number, value: string) => void;
  runWorkflow: () => void;
  onModelChange: (key: "primaryModel" | "fallback", index?: number) => (event: ChangeEvent<HTMLInputElement>) => void;
};

function WorkspaceView({ config, batches, sourceTokens, isRunning, transcriptInputRef, onTranscriptInput, onDrop, onDragOver, updateConfig, updateFallback, runWorkflow, onModelChange }: WorkspaceProps) {
  const safeBatchPercent = clamp(Math.round((config.batchTokens / Math.max(config.contextWindow - 800, 1)) * 100), 1, 100);
  return <div className="workspace-view">
    <section className="panel source-panel" id="source-panel">
      <div className="panel-heading">
        <div className="panel-heading-main"><span className="section-index">01</span><div><p className="panel-kicker">SOURCE TRANSCRIPT</p><h2>Bring in the raw voice</h2></div></div>
        <div className="panel-tools"><span className="file-pill"><Icon name="file" size={14} />{config.sourceFileName || "unsaved source"}</span><button className="icon-button" title="Load a text or V.txt ZIP" onClick={() => transcriptInputRef.current?.click()}><Icon name="upload" size={16} /></button></div>
      </div>
      <div className="source-editor-wrap"><textarea className="source-editor" aria-label="Transcript source" value={config.transcript} onChange={(event) => updateConfig("transcript", event.target.value)} spellCheck={false} /><div className="editor-footer"><span><span className="editor-live-dot" />Editable source</span><span>{formatNumber(config.transcript.length)} characters · {formatNumber(sourceTokens)} est. tokens</span></div></div>
      <div className="dropzone" onClick={() => transcriptInputRef.current?.click()} onDrop={onDrop} onDragOver={onDragOver} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") transcriptInputRef.current?.click(); }}>
        <input ref={transcriptInputRef} className="visually-hidden" type="file" accept=".txt,.md,.markdown,.zip,text/plain,application/zip" onChange={onTranscriptInput} />
        <span className="drop-icon"><Icon name="upload" size={19} /></span><span><strong>Drop a transcript or V.txt ZIP</strong><small>TXT, MD, or ZIP · V.txt is picked automatically</small></span><span className="drop-browse">Browse <Icon name="chevron" size={13} /></span>
      </div>
    </section>

    <div className="detail-grid">
      <section className="panel compact-panel">
        <div className="panel-heading"><div className="panel-heading-main"><span className="section-index">02</span><div><p className="panel-kicker">WORKFLOW IDENTITY</p><h2>Name the handoff</h2></div></div><Icon name="layers" size={19} /></div>
        <label className="field-label">Workflow name<input className="text-input" value={config.name} onChange={(event) => updateConfig("name", event.target.value)} placeholder="e.g. Podcast clean edit" /></label>
        <label className="field-label">Description<textarea className="small-textarea" value={config.description} onChange={(event) => updateConfig("description", event.target.value)} placeholder="What this workflow is for" /></label>
        <div className="stored-note"><Icon name="lock" size={13} /><span>Identity is saved with the workflow file and share link.</span></div>
      </section>

      <section className="panel compact-panel rules-panel">
        <div className="panel-heading"><div className="panel-heading-main"><span className="section-index">03</span><div><p className="panel-kicker">EDITORIAL CONTRACT</p><h2>Rules the model cannot forget</h2></div></div><Icon name="sliders" size={19} /></div>
        <label className="field-label">Format rules<textarea className="rule-textarea" value={config.formatRules} onChange={(event) => updateConfig("formatRules", event.target.value)} /></label>
        <label className="field-label">Edit rules<textarea className="rule-textarea" value={config.editRules} onChange={(event) => updateConfig("editRules", event.target.value)} /></label>
        <div className="rule-foot"><span><span className="tiny-check"><Icon name="check" size={10} /></span>Applied on every batch</span><span>Persisted</span></div>
      </section>
    </div>

    <section className="panel prompt-panel">
      <div className="prompt-side"><span className="section-index">04</span><div><p className="panel-kicker">MASTER PROMPT</p><h2>Guardrails for every call</h2><p>This instruction is prepended to Normalize, Format, and Edit. Keep it stable; tune the rules above for a project-specific change.</p></div></div>
      <div className="prompt-editor"><textarea value={config.masterPrompt} onChange={(event) => updateConfig("masterPrompt", event.target.value)} aria-label="Master prompt" /><div><span><Icon name="lock" size={12} />Included in every request</span><span>{formatNumber(estimateTokens(config.masterPrompt))} prompt tokens</span></div></div>
    </section>

    <section className="panel model-panel">
      <div className="panel-heading model-heading"><div className="panel-heading-main"><span className="section-index">05</span><div><p className="panel-kicker">MODEL ROUTING &amp; CONTEXT</p><h2>Make limits visible before you run</h2><p className="panel-subtitle">Batch size is estimated at four characters per token. Fallbacks are attempted in order when a model errors or rate-limits.</p></div></div><div className="route-health"><span className="status-dot green" />fallback-aware</div></div>
      <datalist id="model-suggestions">{MODEL_OPTIONS.map((model) => <option value={model} key={model} />)}</datalist>
      <div className="model-grid">
        <label className="field-label wide-field">Primary model<input className="text-input mono-input" list="model-suggestions" value={config.primaryModel} onChange={onModelChange("primaryModel")} /></label>
        <label className="field-label">Context window<select className="text-input" value={config.contextWindow} onChange={(event) => updateConfig("contextWindow", Number(event.target.value))}><option value={8192}>8,192 tokens</option><option value={16384}>16,384 tokens</option><option value={32768}>32,768 tokens</option><option value={65536}>65,536 tokens</option><option value={131072}>131,072 tokens</option></select></label>
        <label className="field-label">Fallback 01<input className="text-input mono-input" list="model-suggestions" value={config.fallbackModels[0] || ""} onChange={onModelChange("fallback", 0)} placeholder="Optional model" /></label>
        <label className="field-label">Fallback 02<input className="text-input mono-input" list="model-suggestions" value={config.fallbackModels[1] || ""} onChange={onModelChange("fallback", 1)} placeholder="Optional model" /></label>
        <label className="field-label">Batch target<input className="text-input" type="number" min={400} max={20000} value={config.batchTokens} onChange={(event) => updateConfig("batchTokens", clamp(Number(event.target.value) || 400, 400, 20000))} /><small className="field-hint">{formatNumber(batches.length)} planned batch{batches.length === 1 ? "" : "es"}</small></label>
        <label className="field-label">Overlap context<input className="text-input" type="number" min={0} max={1000} value={config.overlapTokens} onChange={(event) => updateConfig("overlapTokens", clamp(Number(event.target.value) || 0, 0, 1000))} /><small className="field-hint">Continuity only, never duplicated</small></label>
        <label className="field-label">Max output tokens<input className="text-input" type="number" min={256} max={16000} value={config.maxOutputTokens} onChange={(event) => updateConfig("maxOutputTokens", clamp(Number(event.target.value) || 256, 256, 16000))} /></label>
        <label className="field-label temperature-field">Temperature<div className="range-row"><input type="range" min="0" max="1" step="0.05" value={config.temperature} onChange={(event) => updateConfig("temperature", Number(event.target.value))} /><output>{config.temperature.toFixed(2)}</output></div></label>
      </div>
      <div className="capacity-row"><div><span className="capacity-label"><Icon name="activity" size={14} />SAFE INPUT CAPACITY</span><span className="capacity-copy">{formatNumber(config.batchTokens)} target tokens / {formatNumber(config.contextWindow)} context</span></div><div className="capacity-meter"><span style={{ width: `${safeBatchPercent}%` }} /></div><strong>{safeBatchPercent}%</strong></div>
      <div className="security-note"><Icon name="lock" size={14} /><span>Model keys are never stored in the browser. Add <code>NVIDIA_API_KEY</code> to Vercel server environment variables to switch from local preview to NVIDIA inference.</span></div>
    </section>

    <section className="run-card">
      <div className="run-card-copy"><div className="run-orb"><Icon name={isRunning ? "activity" : "play"} size={20} /></div><div><p className="panel-kicker">READY WHEN YOU ARE</p><h2>{isRunning ? "Pipeline is running" : `Run ${formatNumber(batches.length)} safe batch${batches.length === 1 ? "" : "es"}`}</h2><p>{isRunning ? "Each stage is traced separately. You can keep this tab open while the route works." : "Normalize → Format → Edit. Every call receives one process, one batch, and the same editorial contract."}</p></div></div>
      <button className="run-button" onClick={runWorkflow} disabled={isRunning || !config.transcript.trim()}>{isRunning ? <><span className="button-spinner" />Running…</> : <><Icon name="play" size={16} />Start workflow <Icon name="chevron" size={15} /></>}</button>
    </section>
  </div>;
}

type TraceProps = {
  trace: TraceEvent[];
  progress: Progress;
  progressPercent: number;
  isRunning: boolean;
  result: string;
  runWorkflow: () => void;
  sourceTokens: number;
  batchCount: number;
};

function TraceView({ trace, progress, progressPercent, isRunning, result, runWorkflow, sourceTokens, batchCount }: TraceProps) {
  return <div className="trace-view">
    <section className="trace-hero panel">
      <div className="trace-progress-orb"><div><strong>{progressPercent}</strong><span>%</span></div><svg viewBox="0 0 100 100" aria-hidden="true"><circle className="orb-track" cx="50" cy="50" r="42" /><circle className="orb-value" cx="50" cy="50" r="42" style={{ strokeDashoffset: 264 - (264 * progressPercent) / 100 }} /></svg></div>
      <div className="trace-hero-copy"><p className="panel-kicker">LIVE PROCESS TRACE</p><h2>{isRunning ? `Editing batch ${Math.min(progress.batch + 1, progress.total)} of ${progress.total}` : result ? "Workflow complete" : "No run in this draft yet"}</h2><p>{isRunning ? `Current process: ${PIPELINE[progress.stageIndex]?.label || "Preparing"}. Calls are sequential so no stage can silently skip the contract.` : result ? "The final assembly is ready. Review the full edit and run the cross-check before you publish." : `Your ${formatNumber(sourceTokens)} source tokens are planned across ${formatNumber(batchCount)} safe batch${batchCount === 1 ? "" : "es"}.`}</p><div className="trace-hero-meta"><span><Icon name="clock" size={13} />{isRunning ? "working now" : "trace retained in draft"}</span><span><Icon name="layers" size={13} />{formatNumber(trace.length)} events recorded</span></div></div>
      <button className="button button-primary trace-run-button" onClick={runWorkflow} disabled={isRunning}>{isRunning ? <><span className="button-spinner" />Running</> : <><Icon name="refresh" size={15} />{result ? "Run again" : "Run workflow"}</>}</button>
    </section>

    <div className="trace-layout">
      <section className="panel trace-timeline-panel">
        <div className="panel-heading"><div className="panel-heading-main"><span className="section-index">LOG</span><div><p className="panel-kicker">EXECUTION TIMELINE</p><h2>Every process, visible</h2></div></div><span className="trace-live-pill"><span className={isRunning ? "pulse-dot" : "status-dot green"} />{isRunning ? "LIVE" : "RETAINED"}</span></div>
        {trace.length ? <div className="trace-list">{trace.map((event) => <TraceRow event={event} key={event.id} />)}</div> : <div className="empty-trace"><span className="empty-trace-icon"><Icon name="activity" size={21} /></span><strong>Trace starts with your first run</strong><span>Planner, model calls, fallback attempts, batch joins, and errors will appear here.</span></div>}
      </section>

      <aside className="trace-aside">
        <section className="panel batch-map-panel"><div className="aside-heading"><span>BATCH PLAN</span><Icon name="layers" size={16} /></div><div className="batch-map-count"><strong>{formatNumber(batchCount)}</strong><span>safe batch{batchCount === 1 ? "" : "es"}</span></div><div className="batch-bars">{Array.from({ length: Math.min(batchCount, 12) }).map((_, index) => <span key={index} className={progress.batch > index || (!isRunning && result) ? "done" : progress.batch === index && isRunning ? "active" : ""} />)}{batchCount > 12 && <em>+{batchCount - 12}</em>}</div><p>Each batch runs Normalize, Format, then Edit. Continuity context is sent as reference and never duplicated in assembly.</p></section>
        <section className="panel error-handling-panel"><div className="aside-heading"><span>ERROR POLICY</span><Icon name="alert" size={16} /></div><div className="policy-row"><span className="policy-number">01</span><div><strong>Retry in order</strong><span>Primary → fallback 01 → fallback 02</span></div></div><div className="policy-row"><span className="policy-number">02</span><div><strong>Stop safely</strong><span>A failed stage never pollutes final output</span></div></div><div className="policy-row"><span className="policy-number">03</span><div><strong>Trace the reason</strong><span>Provider status and model are logged</span></div></div></section>
      </aside>
    </div>
  </div>;
}

function TraceRow({ event }: { event: TraceEvent }) {
  const icon = event.status === "success" ? "check" : event.status === "error" ? "alert" : event.status === "running" ? "activity" : "clock";
  return <div className={`trace-row ${event.status}`}><div className="trace-row-status"><span><Icon name={icon} size={14} /></span></div><div className="trace-row-main"><div className="trace-row-title"><strong>{event.label}</strong><span className={`trace-status-label ${event.status}`}>{event.status}</span></div><div className="trace-row-detail"><span>{event.batch && event.total ? `Batch ${event.batch}/${event.total}` : "Workflow"}</span>{event.model && <><i /> <span className="mono-text">{shortModel(event.model)}</span></>}{event.demo && <><i /><span className="demo-label">local preview</span></>}</div>{event.message && <p>{event.message}</p>}</div><div className="trace-row-time"><span>{event.duration !== undefined ? `${event.duration}ms` : "—"}</span><small>{timeLabel(event.timestamp)}</small></div></div>;
}

type OutputProps = {
  result: string;
  outputTokens: number;
  crossChecks: SectionCheck[];
  isChecking: boolean;
  downloadText: () => void;
  downloadPdf: () => void;
  copyOutput: () => void;
  runCrossCheck: () => void;
  goToWorkspace: () => void;
};

function OutputView({ result, outputTokens, crossChecks, isChecking, downloadText, downloadPdf, copyOutput, runCrossCheck, goToWorkspace }: OutputProps) {
  const passed = crossChecks.filter((check) => check.status === "pass").length;
  const flagged = crossChecks.filter((check) => check.status === "review").length;
  return <div className="output-view">
    <section className="output-header panel"><div><p className="panel-kicker">FINAL ASSEMBLY</p><h2>Full edited transcript</h2><p>{result ? "The output below is joined in source order after every batch completed the three editing passes." : "Run the workflow to assemble a full edited version here."}</p></div><div className="output-actions"><button className="button button-ghost" onClick={copyOutput} disabled={!result}><Icon name="copy" size={15} />Copy</button><button className="button button-ghost" onClick={downloadText} disabled={!result}><Icon name="download" size={15} />TXT</button><button className="button button-primary" onClick={downloadPdf} disabled={!result}><Icon name="download" size={15} />PDF</button></div></section>
    {!result ? <div className="empty-output panel"><div className="empty-output-art"><Icon name="file" size={26} /></div><h3>Your finished transcript will land here</h3><p>Keep all of the configured fields, then start the workflow. The final assembly will be downloadable as PDF or TXT.</p><button className="button button-primary" onClick={goToWorkspace}><Icon name="sliders" size={15} />Configure workflow</button></div> : <>
      <section className="output-document panel"><div className="document-toolbar"><span className="document-label"><span className="document-dot" />EDITED VERSION</span><span>{formatNumber(result.length)} characters · {formatNumber(outputTokens)} est. tokens</span><span className="document-order">SOURCE ORDER <Icon name="check" size={12} /></span></div><pre>{result}</pre></section>
      <section className="crosscheck-panel panel"><div className="crosscheck-heading"><div className="panel-heading-main"><span className="section-index">QC</span><div><p className="panel-kicker">CROSS-CHECK</p><h2>Does each section hold up?</h2><p className="panel-subtitle">Deterministic review for unresolved markers, repetition, and punctuation. It never changes the text.</p></div></div><button className="button button-primary" onClick={runCrossCheck} disabled={isChecking}>{isChecking ? <><span className="button-spinner" />Checking…</> : <><Icon name="refresh" size={15} />{crossChecks.length ? "Run again" : "Check sections"}</>}</button></div>{crossChecks.length ? <><div className="check-summary"><div><span className="check-score-value">{flagged ? "Review" : "Clear"}</span><span className="check-score-label">{flagged ? `${flagged} flagged section${flagged === 1 ? "" : "s"}` : "All sections passed"}</span></div><div className="summary-count pass"><Icon name="check" size={14} />{passed} pass</div><div className="summary-count review"><Icon name="alert" size={14} />{flagged} review</div></div><div className="check-list">{crossChecks.map((check) => <div className={`check-row ${check.status}`} key={check.section}><span className="check-number">{String(check.section).padStart(2, "0")}</span><span className="check-state"><Icon name={check.status === "pass" ? "check" : "alert"} size={13} /></span><div><strong>Section {check.section}</strong><span>{check.note}</span></div><b>{check.score}</b></div>)}</div></> : <div className="check-empty"><span className="check-empty-icon"><Icon name="activity" size={17} /></span><span>Run a cross-check after reviewing the full assembly. Sections that need human attention will be called out here.</span></div>}</section>
    </>}
  </div>;
}
