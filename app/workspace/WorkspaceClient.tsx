'use client';

import JSZip from "jszip";
import { jsPDF } from "jspdf";
import Link from "next/link";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import CopyButton from "../../components/CopyButton";
import EditsCanvas from "../../components/EditsCanvas";
import GuidingRules from "../../components/GuidingRules";
import Icon from "../../components/Icon";
import ProceedingOverlay, { type OverlayLog, type OverlayStep } from "../../components/ProceedingOverlay";
import { requestJson } from "../../lib/http";
import { capToWords, countWords } from "../../lib/limits";
import { clearDraft, readDraft, readLocalJob, upsertLocalJob, writeDraft } from "../../lib/local-jobs";
import { createJobRecord, emptyStages, jobTitleFromSource, parseJobRecord, type Account, type ErrorEvent, type JobKind, type JobRecord, type ResumeCursor } from "../../lib/types";
import {
  chunkTranscript,
  DEFAULT_CONFIG,
  DEFAULT_TEMPLATES,
  estimateTokens,
  formatNumber,
  makeId,
  normalizeConfig,
  normalizeOutputGuide,
  PIPELINE,
  sectionChecks,
  shortModel,
  slugify,
  type WorkflowConfig,
  type WorkflowTemplate,
} from "../../lib/workflow";

type Notice = { tone: "success" | "error" | "info"; message: string };

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

function assemble(batches: JobRecord["batches"], key: "normalize" | "format" | "edit") {
  return batches.map((batch) => batch[key]).filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

export default function WorkspaceClient({ account, jobId }: { account: Account; jobId?: string }) {
  const [config, setConfig] = useState<WorkflowConfig>({ ...DEFAULT_CONFIG, fallbackModels: [...DEFAULT_CONFIG.fallbackModels] });
  const [kind, setKind] = useState<JobKind>(account.canBookJob ? "job" : "demo");
  const [job, setJob] = useState<JobRecord | null>(null);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(DEFAULT_TEMPLATES);
  const [hydrated, setHydrated] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [refineInstruction, setRefineInstruction] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checking, setChecking] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const [overlayTitle, setOverlayTitle] = useState("Working through your source");
  const [overlaySubtitle, setOverlaySubtitle] = useState("Each pass is isolated, traced, and handed forward only after it completes.");
  const [overlayPercent, setOverlayPercent] = useState(0);
  const [overlaySteps, setOverlaySteps] = useState<OverlayStep[]>([]);
  const [overlayLog, setOverlayLog] = useState<OverlayLog[]>([]);
  const [overlayError, setOverlayError] = useState<{ message: string; retryable?: boolean } | null>(null);
  const [overlayBusy, setOverlayBusy] = useState(false);
  const [summaryLeft, setSummaryLeft] = useState("");
  const [summaryRight, setSummaryRight] = useState("");
  const transcriptInputRef = useRef<HTMLInputElement>(null);
  const pauseRef = useRef(false);
  const jobRef = useRef<JobRecord | null>(null);
  const persistTimer = useRef<number | null>(null);

  const words = countWords(config.transcript);
  const cap = account.demoWordCap;
  const overCap = kind === "demo" && words > cap;
  const batches = useMemo(() => chunkTranscript(config.transcript, config.batchTokens), [config.transcript, config.batchTokens]);
  const showCanvas = Boolean(job && (job.result || job.stages.edit || job.stages.normalize || job.status === "complete" || job.status === "failed" || job.status === "paused"));

  const pushLog = useCallback((text: string, tone: OverlayLog["tone"] = "info", meta?: string) => {
    setOverlayLog((current) => [...current, { id: makeId(), text, tone, meta }]);
  }, []);

  const persist = useCallback(async (next: JobRecord) => {
    jobRef.current = next;
    setJob(next);
    upsertLocalJob(next);
    if (account.persistence !== "database") return;
    if (persistTimer.current) window.clearTimeout(persistTimer.current);
    persistTimer.current = window.setTimeout(() => {
      void requestJson(`/api/jobs/${next.id}`, { method: "PATCH", body: JSON.stringify(next) }, { retries: 1 });
    }, 400);
  }, [account.persistence]);

  const createAndPersist = useCallback(async (draft: JobRecord) => {
    upsertLocalJob(draft);
    if (account.persistence === "database") {
      const { data } = await requestJson<{ job?: JobRecord }>(
        "/api/jobs",
        { method: "POST", body: JSON.stringify(draft) },
        { retries: 1 },
      );
      const saved = data.job ? parseJobRecord(data.job) : draft;
      if (saved) {
        jobRef.current = saved;
        setJob(saved);
        upsertLocalJob(saved);
        return saved;
      }
    }
    jobRef.current = draft;
    setJob(draft);
    return draft;
  }, [account.persistence]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let defaults = normalizeConfig(DEFAULT_CONFIG);
      try {
        const [wfRes, tplRes] = await Promise.all([
          requestJson<{ workflow?: { config?: unknown } | null }>("/api/workflow"),
          requestJson<{ templates?: WorkflowTemplate[] }>("/api/templates"),
        ]);
        if (wfRes.data.workflow?.config) defaults = normalizeConfig(wfRes.data.workflow.config);
        if (Array.isArray(tplRes.data.templates) && tplRes.data.templates.length) {
          setTemplates(tplRes.data.templates);
        }
      } catch { /* defaults */ }

      if (jobId) {
        let loaded: JobRecord | null = null;
        try {
          const { data } = await requestJson<{ job?: JobRecord | null }>(`/api/jobs/${jobId}`);
          loaded = data.job ? parseJobRecord(data.job) : null;
        } catch { /* local */ }
        if (!loaded) loaded = readLocalJob(jobId);
        if (!cancelled && loaded) {
          jobRef.current = loaded;
          setJob(loaded);
          setKind(loaded.kind);
          setConfig(normalizeConfig({ ...defaults, ...loaded.config, transcript: loaded.source, sourceFileName: loaded.sourceFileName }));
          if (loaded.status === "failed" || loaded.status === "paused" || loaded.status === "running") {
            setOverlayOpen(true);
            setOverlayTitle(loaded.status === "failed" ? "This edit can continue" : "Ready to continue");
            setOverlaySubtitle("The last successful pass is saved. Retry the failed step or continue later.");
            setOverlayError(loaded.errorLog[loaded.errorLog.length - 1] ? { message: loaded.errorLog[loaded.errorLog.length - 1].message, retryable: true } : { message: "This run stopped before it finished.", retryable: true });
            setOverlayPercent(loaded.resumeCursor ? Math.round(((loaded.resumeCursor.batchIndex) / Math.max(1, loaded.batches.length || 1)) * 100) : 8);
            setOverlayLog((loaded.errorLog || []).map((event) => ({ id: event.id, text: event.message, tone: "error" as const, meta: event.stage })));
          }
        } else if (!cancelled) {
          setNotice({ tone: "error", message: "That transcript was not found. Start a new one from the workspace." });
        }
      } else {
        const draft = readDraft();
        setConfig(normalizeConfig({
          ...defaults,
          transcript: draft?.source || "",
          sourceFileName: draft?.sourceFileName || "",
          formatRules: draft?.formatRules || defaults.formatRules,
          editRules: draft?.editRules || defaults.editRules,
          masterPrompt: draft?.masterPrompt || defaults.masterPrompt,
        }));
        setKind(account.canBookJob ? (draft?.kind === "demo" ? "demo" : "job") : "demo");
      }
      if (!cancelled) setHydrated(true);
    }
    void load();
    return () => { cancelled = true; };
  }, [account.canBookJob, jobId]);

  useEffect(() => {
    if (!hydrated || jobId) return;
    writeDraft({
      source: config.transcript,
      sourceFileName: config.sourceFileName,
      kind,
      formatRules: config.formatRules,
      editRules: config.editRules,
      masterPrompt: config.masterPrompt,
    });
  }, [config.editRules, config.formatRules, config.masterPrompt, config.sourceFileName, config.transcript, hydrated, jobId, kind]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const updateConfig = useCallback(<K extends keyof WorkflowConfig>(key: K, value: WorkflowConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  }, []);

  const readFile = useCallback(async (file: File) => {
    let isZip = file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
    if (!isZip) {
      try {
        const slice = await file.slice(0, 4).arrayBuffer();
        const header = new Uint8Array(slice);
        if (header[0] === 0x50 && header[1] === 0x4b && (header[2] === 0x03 || header[2] === 0x05 || header[2] === 0x07)) {
          isZip = true;
        }
      } catch { /* normal text */ }
    }

    if (!isZip) {
      const text = await file.text();
      try {
        const parsed = JSON.parse(text);
        if (parsed?.type === "transcripter-workflow-template" && parsed.template) {
          return {
            text: parsed.template.sampleInput || "",
            name: file.name,
            template: parsed.template as WorkflowTemplate,
          };
        }
      } catch { /* not template json */ }
      return { text, name: file.name, template: null };
    }

    const zip = await JSZip.loadAsync(file);
    const names = Object.keys(zip.files);
    const entryName =
      names.find((name) => !zip.files[name].dir && name.split("/").pop()?.toLowerCase() === "v.txt") ||
      names.find((name) => !zip.files[name].dir && /^(source|transcript|input)\.(txt|md)$/i.test(name.split("/").pop() || "")) ||
      names.find((name) => !zip.files[name].dir && /\.(txt|md|markdown)$/i.test(name) && !/(rules|guide|checks|output)/i.test(name)) ||
      names.find((name) => !zip.files[name].dir && /\.(txt|md|markdown)$/i.test(name));

    if (!entryName || !zip.file(entryName)) {
      throw new Error("The ZIP must contain V.txt or a text/markdown file.");
    }
    const transcriptText = await zip.file(entryName)!.async("text");

    let extractedTemplate: Partial<WorkflowTemplate> | null = null;
    const jsonTemplateFile = names.find((n) => !zip.files[n].dir && /(template|workflow|rules|output_guide)\.json$/i.test(n));
    if (jsonTemplateFile) {
      try {
        const rawJson = await zip.file(jsonTemplateFile)!.async("text");
        const parsed = JSON.parse(rawJson);
        extractedTemplate = parsed.template || parsed;
      } catch { /* continue */ }
    } else {
      const rulesFile = names.find((n) => !zip.files[n].dir && /(rules|guide)\.txt$/i.test(n));
      if (rulesFile) {
        try {
          const rulesText = await zip.file(rulesFile)!.async("text");
          extractedTemplate = { formatRules: rulesText, editRules: rulesText };
        } catch { /* continue */ }
      }
    }

    return {
      text: transcriptText,
      name: `${file.name} → ${entryName}`,
      template: extractedTemplate,
    };
  }, []);

  const handleFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      const loaded = await readFile(file);
      updateConfig("transcript", loaded.text);
      updateConfig("sourceFileName", loaded.name);
      if (loaded.template) {
        if (loaded.template.formatRules) updateConfig("formatRules", loaded.template.formatRules);
        if (loaded.template.editRules) updateConfig("editRules", loaded.template.editRules);
        if (loaded.template.masterPrompt) updateConfig("masterPrompt", loaded.template.masterPrompt);
        if (loaded.template.outputGuide) updateConfig("outputGuide", normalizeOutputGuide(loaded.template.outputGuide));
        setNotice({ tone: "success", message: `${loaded.name} is loaded and packaged template rules & output guide applied.` });
      } else {
        setNotice({ tone: "success", message: `${loaded.name} is loaded.` });
      }
    } catch (caught) {
      setOverlayOpen(true);
      setOverlayBusy(false);
      setOverlayTitle("This file could not be opened");
      setOverlayError({ message: caught instanceof Error ? caught.message : "This file could not be opened.", retryable: false });
    }
  }, [readFile, updateConfig]);

  const runWorkflow = useCallback(async (mode: "fresh" | "resume" | "retry" = "fresh") => {
    if (overlayBusy && mode === "fresh") return;
    if (!config.transcript.trim()) {
      setOverlayOpen(true);
      setOverlayBusy(false);
      setOverlayTitle("Add a transcript first");
      setOverlayError({ message: "Paste or upload a source before starting the edit.", retryable: false });
      return;
    }
    if (kind === "job" && !account.canBookJob) {
      setOverlayOpen(true);
      setOverlayBusy(false);
      setOverlayTitle("This account cannot book a job");
      setOverlaySubtitle(`Registrations stay on a ${cap}-word demo until an admin sets your status to approved.`);
      setOverlayError({ message: "Run a demo instead, or wait for approval.", retryable: false });
      setKind("demo");
      return;
    }

    let source = config.transcript;
    if (kind === "demo") {
      const capped = capToWords(source, cap);
      if (capped.truncated) {
        source = capped.text;
        updateConfig("transcript", source);
      }
    }

    const safeBatches = chunkTranscript(source, config.batchTokens);
    if (!safeBatches.length) return;

    pauseRef.current = false;
    setOverlayOpen(true);
    setOverlayBusy(true);
    setOverlayError(null);
    setOverlayTitle("Working through your source");
    setOverlaySubtitle("Live updates replace alerts. If a pass fails, you can retry it without losing earlier batches.");
    setOverlayLog([]);
    setOverlaySteps(PIPELINE.map((stage) => ({ key: stage.key, label: stage.label, description: stage.description, status: "waiting" as const })));

    // Refresh latest system settings if available
    let activeConfig = config;
    try {
      const { data: wfData } = await requestJson<{ workflow?: { config?: unknown } | null }>("/api/workflow");
      if (wfData?.workflow?.config) {
        const latestNormalized = normalizeConfig(wfData.workflow.config);
        activeConfig = {
          ...config,
          primaryModel: latestNormalized.primaryModel,
          fallbackModels: latestNormalized.fallbackModels,
        };
        setConfig(activeConfig);
      }
    } catch {
      // Continue with active configuration
    }

    let currentJob = jobRef.current;
    if (mode === "fresh" || !currentJob) {
      const created = createJobRecord({
        ownerEmail: account.email,
        kind,
        config: { ...activeConfig, transcript: source },
        source,
        sourceFileName: activeConfig.sourceFileName,
        title: jobTitleFromSource(source, activeConfig.sourceFileName),
        id: currentJob?.id,
      });
      created.status = "running";
      created.batches = safeBatches.map((text, index) => ({ index, source: text, normalize: "", format: "", edit: "" }));
      created.stages = emptyStages();
      created.result = "";
      created.errorLog = [];
      created.resumeCursor = { batchIndex: 0, stageIndex: 0, continuity: "" };
      currentJob = await createAndPersist(created);
      clearDraft();
      if (!jobId && typeof window !== "undefined") {
        window.history.replaceState(null, "", `/workspace/${currentJob.id}`);
      }
    } else {
      currentJob = { ...currentJob, status: "running", kind, source, config: { ...activeConfig, transcript: source } };
      await persist(currentJob);
    }

    const workBatches = currentJob.batches.length ? currentJob.batches : safeBatches.map((text, index) => ({ index, source: text, normalize: "", format: "", edit: "" }));
    const cursor: ResumeCursor = mode === "fresh" || !currentJob.resumeCursor
      ? { batchIndex: 0, stageIndex: 0, continuity: "" }
      : currentJob.resumeCursor;
    const startBatch = Math.min(cursor.batchIndex, Math.max(0, workBatches.length - 1));
    const startStage = mode === "retry" ? cursor.stageIndex : Math.min(cursor.stageIndex, PIPELINE.length - 1);
    pushLog(mode === "fresh" ? "Source planned" : "Continuing from the last saved pass", "success", `${workBatches.length} batch${workBatches.length === 1 ? "" : "es"}`);

    let continuity = cursor.continuity || "";
    const startedAt = Date.now();

    try {
      for (let batchIndex = startBatch; batchIndex < workBatches.length; batchIndex += 1) {
        if (pauseRef.current) throw Object.assign(new Error("PAUSED"), { code: "PAUSED" });
        const stageStart = batchIndex === startBatch ? startStage : 0;
        let currentText = workBatches[batchIndex].source;
        if (stageStart === 1 && workBatches[batchIndex].normalize) currentText = workBatches[batchIndex].normalize;
        if (stageStart === 2 && workBatches[batchIndex].format) currentText = workBatches[batchIndex].format;

        for (let stageIndex = stageStart; stageIndex < PIPELINE.length; stageIndex += 1) {
          if (pauseRef.current) throw Object.assign(new Error("PAUSED"), { code: "PAUSED" });
          const stage = PIPELINE[stageIndex];
          setOverlaySteps(PIPELINE.map((item, index) => ({
            key: item.key,
            label: item.label,
            description: item.description,
            status: index < stageIndex ? "done" : index === stageIndex ? "active" : "waiting",
          })));
          const percent = Math.max(4, Math.round(((batchIndex * PIPELINE.length + stageIndex) / (workBatches.length * PIPELINE.length)) * 100));
          setOverlayPercent(percent);
          setSummaryLeft(`Batch ${batchIndex + 1} of ${workBatches.length}`);
          setSummaryRight(stage.label);
          pushLog(`${stage.label} · batch ${batchIndex + 1}`, "running");

          const isAdmin = account.role === "admin";
          const { ok, data } = await requestJson<{
            ok?: boolean;
            output?: string;
            error?: string;
            modelUsed?: string;
            demo?: boolean;
            warning?: string;
            retryable?: boolean;
            attempts?: { model: string; error: string }[];
          }>(
            "/api/process",
            {
              method: "POST",
              body: JSON.stringify({
                stage: stage.key,
                text: currentText,
                masterPrompt: activeConfig.masterPrompt,
                formatRules: activeConfig.formatRules,
                editRules: activeConfig.editRules,
                contextWindow: activeConfig.contextWindow,
                maxOutputTokens: activeConfig.maxOutputTokens,
                temperature: activeConfig.temperature,
                batch: { index: batchIndex, total: workBatches.length },
                contextBefore: continuity,
                kind,
                jobId: currentJob.id,
              }),
            },
            {
              retries: 0,
              onRetry: (attempt, reason) => pushLog(`Retrying ${stage.label} (${attempt})`, "info", reason),
            },
          );

          if (!ok || !data.output?.trim()) {
            const attempts = isAdmin && data.attempts?.length
              ? ` ${data.attempts.map((attempt) => `${shortModel(attempt.model)}: ${attempt.error}`).join(" | ")}`
              : "";
            const message = `${data.error || "This pass did not return an output."}${attempts}`;
            const event: ErrorEvent = {
              id: makeId(),
              timestamp: new Date().toISOString(),
              stage: stage.key,
              batch: batchIndex + 1,
              total: workBatches.length,
              code: "PASS_FAILED",
              message,
              retryable: data.retryable !== false,
            };
            void requestJson("/api/errors", { method: "POST", body: JSON.stringify({ jobId: currentJob.id, stage: stage.key, batch: batchIndex, code: "PASS_FAILED", message }) }, { retries: 0 });
            const failed: JobRecord = {
              ...currentJob,
              batches: workBatches,
              stages: {
                normalize: assemble(workBatches, "normalize"),
                format: assemble(workBatches, "format"),
                edit: assemble(workBatches, "edit"),
                refine: currentJob.stages.refine,
              },
              status: "failed",
              resumeCursor: { batchIndex, stageIndex, continuity },
              errorLog: [...currentJob.errorLog, event].slice(-80),
              updatedAt: new Date().toISOString(),
            };
            await persist(failed);
            setOverlayBusy(false);
            setOverlayError({ message, retryable: event.retryable });
            setOverlayTitle("This pass stopped");
            setOverlaySteps((steps) => steps.map((item) => item.key === stage.key ? { ...item, status: "error" } : item));
            pushLog(message, "error", `${stage.label} · batch ${batchIndex + 1}`);
            return;
          }

          currentText = data.output.trim();
          if (stage.key === "normalize") workBatches[batchIndex].normalize = currentText;
          if (stage.key === "format") workBatches[batchIndex].format = currentText;
          if (stage.key === "edit") workBatches[batchIndex].edit = currentText;
          pushLog(
            data.warning || `${stage.label} complete`,
            "success",
            isAdmin && data.modelUsed ? shortModel(data.modelUsed) : undefined
          );
          currentJob = {
            ...currentJob,
            batches: workBatches.map((batch) => ({ ...batch })),
            stages: {
              normalize: assemble(workBatches, "normalize"),
              format: assemble(workBatches, "format"),
              edit: assemble(workBatches, "edit"),
              refine: currentJob.stages.refine,
            },
            resumeCursor: { batchIndex, stageIndex: stageIndex + 1, continuity },
            status: "running",
            updatedAt: new Date().toISOString(),
          };
          await persist(currentJob);
        }
        continuity = currentText.slice(-Math.max(0, config.overlapTokens) * 4);
      }

      const edited = assemble(workBatches, "edit") || assemble(workBatches, "format") || assemble(workBatches, "normalize");
      const complete: JobRecord = {
        ...currentJob,
        batches: workBatches,
        stages: {
          normalize: assemble(workBatches, "normalize"),
          format: assemble(workBatches, "format"),
          edit: edited,
          refine: currentJob.stages.refine,
        },
        result: edited,
        status: "complete",
        resumeCursor: null,
        updatedAt: new Date().toISOString(),
      };
      await persist(complete);
      setOverlayPercent(100);
      setOverlayBusy(false);
      setOverlayTitle("Your edited transcript is ready");
      setOverlaySubtitle(`Assembled in ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))}s. Open the canvas to copy any part.`);
      setOverlaySteps(PIPELINE.map((stage) => ({ key: stage.key, label: stage.label, description: stage.description, status: "done" as const })));
      pushLog("Edit assembled", "success", `${formatNumber(estimateTokens(edited))} output tokens`);
      setNotice({ tone: "success", message: "Your edited transcript is ready to review." });
    } catch (caught) {
      const paused = caught instanceof Error && (caught.message === "PAUSED" || (caught as { code?: string }).code === "PAUSED");
      const current = jobRef.current;
      if (current) {
        await persist({ ...current, status: paused ? "paused" : "failed", updatedAt: new Date().toISOString() });
      }
      setOverlayBusy(false);
      if (paused) {
        setOverlayTitle("Saved — continue whenever you are ready");
        setOverlaySubtitle("Nothing was lost. Retry or continue from the last successful pass.");
        pushLog("Run paused and saved", "info");
      } else {
        const message = caught instanceof Error ? caught.message : "The edit stopped unexpectedly.";
        setOverlayError({ message, retryable: true });
        setOverlayTitle("This edit stopped");
        pushLog(message, "error");
      }
    }
  }, [account.canBookJob, account.email, cap, config, createAndPersist, jobId, kind, overlayBusy, persist, pushLog, updateConfig]);

  const runRefine = useCallback(async () => {
    const current = jobRef.current;
    const base = (current?.stages.refine || current?.stages.edit || current?.result || "").trim();
    if (!base) {
      setOverlayOpen(true);
      setOverlayBusy(false);
      setOverlayTitle("Nothing to refine yet");
      setOverlayError({ message: "Run an edit first, then request changes from the canvas.", retryable: false });
      return;
    }
    if (!refineInstruction.trim()) {
      setOverlayOpen(true);
      setOverlayBusy(false);
      setOverlayTitle("Describe the change");
      setOverlayError({ message: "Write the change you want — for example, tighten speaker labels or keep the joke.", retryable: false });
      return;
    }
    pauseRef.current = false;
    setOverlayOpen(true);
    setOverlayBusy(true);
    setOverlayError(null);
    setOverlayTitle("Applying your requested changes");
    setOverlaySubtitle("A refine pass uses the current edited transcript plus your instruction.");
    setOverlayPercent(35);
    pushLog("Refine pass started", "running");
    const isAdmin = account.role === "admin";
    const { ok, data } = await requestJson<{ output?: string; error?: string; retryable?: boolean; modelUsed?: string }>(
      "/api/process",
      {
        method: "POST",
        body: JSON.stringify({
          stage: "refine",
          text: base,
          masterPrompt: config.masterPrompt,
          formatRules: config.formatRules,
          editRules: `${config.editRules}\n\nRequested changes:\n${refineInstruction}`,
          refineInstruction,
          contextWindow: config.contextWindow,
          maxOutputTokens: config.maxOutputTokens,
          temperature: config.temperature,
          kind,
          jobId: current?.id,
        }),
      },
      { retries: 0, onRetry: (attempt, reason) => pushLog(`Retrying refine (${attempt})`, "info", reason) },
    );
    if (!ok || !data.output?.trim()) {
      setOverlayBusy(false);
      setOverlayError({ message: data.error || "The refine pass did not return an output.", retryable: data.retryable !== false });
      return;
    }
    if (current) {
      await persist({
        ...current,
        stages: { ...current.stages, refine: data.output.trim() },
        result: data.output.trim(),
        status: "complete",
        updatedAt: new Date().toISOString(),
      });
    }
    setOverlayPercent(100);
    setOverlayBusy(false);
    setOverlayTitle("Requested changes applied");
    pushLog("Refine complete", "success", isAdmin && data.modelUsed ? shortModel(data.modelUsed) : undefined);
    setNotice({ tone: "success", message: "The refined version is on the canvas." });
  }, [config, kind, persist, pushLog, refineInstruction]);

  const runCrossCheck = useCallback(async () => {
    const text = job?.result || job?.stages.edit || "";
    if (!text || checking) return;
    setChecking(true);
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    const checks = sectionChecks(text);
    if (jobRef.current) await persist({ ...jobRef.current, crossChecks: checks, updatedAt: new Date().toISOString() });
    setChecking(false);
    setNotice({
      tone: checks.some((check) => check.status === "review") ? "info" : "success",
      message: checks.some((check) => check.status === "review") ? "A few sections need a human look." : "Every section passed the review scan.",
    });
  }, [checking, job, persist]);

  const downloadText = useCallback(() => {
    const result = job?.result || job?.stages.edit || "";
    if (!result) return;
    downloadBlob(new Blob([result], { type: "text/plain;charset=utf-8" }), `${slugify(job?.title || config.name)}.txt`);
  }, [config.name, job]);

  const downloadPdf = useCallback(() => {
    const result = job?.result || job?.stages.edit || "";
    if (!result) return;
    const pdf = new jsPDF({ unit: "pt", format: "letter" });
    const margin = 54;
    const width = pdf.internal.pageSize.getWidth() - margin * 2;
    const bottom = pdf.internal.pageSize.getHeight() - margin;
    pdf.setTextColor(27, 40, 40);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    pdf.text(job?.title || config.name || "Edited transcript", margin, margin);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(110, 123, 122);
    pdf.text(`Transcripter · ${new Date().toLocaleDateString()}`, margin, margin + 16);
    pdf.setTextColor(35, 48, 48);
    pdf.setFontSize(10.5);
    const lines = pdf.splitTextToSize(result, width) as string[];
    let y = margin + 48;
    lines.forEach((line) => {
      if (y > bottom) {
        pdf.addPage();
        y = margin;
      }
      pdf.text(line, margin, y);
      y += 15;
    });
    pdf.save(`${slugify(job?.title || config.name)}.pdf`);
  }, [config.name, job]);

  const onChangePart = useCallback((part: "source" | "normalize" | "format" | "edit" | "refine", value: string) => {
    if (part === "source") {
      updateConfig("transcript", value);
      if (jobRef.current) void persist({ ...jobRef.current, source: value, wordCount: countWords(value), updatedAt: new Date().toISOString() });
      return;
    }
    if (!jobRef.current) return;
    const stages = { ...jobRef.current.stages, [part]: value };
    const result = part === "refine" || part === "edit" ? value : jobRef.current.result;
    void persist({ ...jobRef.current, stages, result, updatedAt: new Date().toISOString() });
  }, [persist, updateConfig]);

  if (!hydrated) return <main className="workspace-page"><div className="loading-state"><span className="spinner dark" />Opening workspace</div></main>;

  const passedChecks = (job?.crossChecks || []).filter((check) => check.status === "pass").length;
  const flaggedChecks = (job?.crossChecks || []).filter((check) => check.status === "review").length;

  return (
    <main className="workspace-page">
      <header className="page-header workspace-header">
        <div>
          <p className="overline">{jobId ? "TRANSCRIPT" : "NEW TRANSCRIPT"}</p>
          <h1>{jobId ? job?.title || "Open canvas" : "Start with the source."}</h1>
          <p className="page-subtitle">
            {jobId
              ? "Review every stage, copy or paste any part, request changes, or continue a stopped run."
              : "Paste a transcript, adjust the guiding rules if you need to, then run a demo or book a job."}
          </p>
        </div>
        <div className="header-actions">
          <Link className="text-link" href="/history">History <Icon name="arrow" size={15} /></Link>
          {jobId && <Link className="quiet-button" href="/workspace"><Icon name="plus" size={15} />New transcript</Link>}
        </div>
      </header>

      {account.status === "awaiting_approval" && (
        <div className="workspace-notice info">
          <Icon name="lock" size={16} />
          <span>Your registration is awaiting approval. You can run a demo of up to {cap} words. Booking a full job unlocks after an admin sets your status to approved.</span>
        </div>
      )}
      {notice && (
        <div className={`workspace-notice ${notice.tone}`}>
          <Icon name={notice.tone === "error" ? "alert" : notice.tone === "success" ? "check" : "spark"} size={16} />
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" size={15} /></button>
        </div>
      )}

      {!showCanvas && (
        <section className="intake-layout">
          <div className="intake-main">
            <div className="card card-source">
              <div className="card-topline">
                <div>
                  <p className="overline">SOURCE</p>
                  <h2>What are we editing?</h2>
                </div>
                <span className="step-label">{kind === "demo" ? "DEMO" : "JOB"}</span>
              </div>
              <div className="source-input-wrap">
                <textarea
                  value={config.transcript}
                  onChange={(event) => updateConfig("transcript", event.target.value)}
                  placeholder="Paste your transcript here…"
                  aria-label="Transcript source"
                  spellCheck={false}
                />
                <div className="source-meta">
                  <span>{config.transcript ? `${formatNumber(config.transcript.length)} characters · ${formatNumber(words)} words` : "Paste or upload a transcript"}</span>
                  <span className={overCap ? "cap-warn" : ""}>
                    {kind === "demo" ? `${Math.min(words, cap)} / ${cap} demo words` : `${formatNumber(estimateTokens(config.transcript))} estimated tokens`}
                  </span>
                </div>
              </div>
              <div
                className="upload-row"
                onClick={() => transcriptInputRef.current?.click()}
                onDrop={(event: DragEvent<HTMLDivElement>) => { event.preventDefault(); void handleFile(event.dataTransfer.files?.[0]); }}
                onDragOver={(event) => event.preventDefault()}
                role="button"
                tabIndex={0}
                onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") transcriptInputRef.current?.click(); }}
              >
                <input ref={transcriptInputRef} className="visually-hidden" type="file" accept=".txt,.md,.markdown,.zip,text/plain,application/zip" onChange={(event: ChangeEvent<HTMLInputElement>) => { void handleFile(event.target.files?.[0]); event.target.value = ""; }} />
                <span className="upload-icon"><Icon name="upload" size={17} /></span>
                <span><strong>Drop a file here</strong><small>V.txt is selected automatically inside ZIP files</small></span>
                <span className="upload-browse">Browse <Icon name="chevron" size={13} /></span>
              </div>
            </div>
            <div className="source-footer">
              <div className="source-file"><Icon name="file" size={15} /><span>{config.sourceFileName || "Untitled source"}</span></div>
              <CopyButton text={config.transcript} label="Copy source" />
            </div>
          </div>
          <aside className="intake-side">
            <div className="card direction-card">
              <div className="card-topline">
                <p className="overline">WORKFLOW TEMPLATE</p>
                <Icon name="edit" size={17} />
              </div>
              <select
                value={config.templateId || templates[0]?.id || ""}
                onChange={(e) => {
                  const selected = templates.find((t) => t.id === e.target.value);
                  if (selected) {
                    updateConfig("templateId", selected.id);
                    updateConfig("name", selected.name);
                    updateConfig("formatRules", selected.formatRules);
                    updateConfig("editRules", selected.editRules);
                    updateConfig("masterPrompt", selected.masterPrompt);
                    updateConfig("outputGuide", normalizeOutputGuide(selected.outputGuide));
                    setNotice({ tone: "success", message: `Template "${selected.name}" applied.` });
                  }
                }}
                style={{
                  width: "100%",
                  margin: "8px 0 10px",
                  padding: "6px 10px",
                  border: "1px solid var(--line)",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 700,
                  background: "var(--paper)",
                  color: "var(--ink)",
                }}
                aria-label="Select workflow template"
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} ({tpl.category})
                  </option>
                ))}
              </select>
              <p>{config.description || config.outputGuide?.description || "Saved rules and output guide shape each pass."}</p>
              <button type="button" className="card-link" onClick={() => setRulesOpen((open) => !open)}>
                {rulesOpen ? "Hide rules & guide" : "Adjust rules & guide"} <Icon name="chevron" size={14} />
              </button>
              {rulesOpen && <GuidingRules config={config} onChange={updateConfig} />}
              <Link href="/settings" className="card-link">Manage templates &amp; Output Guide <Icon name="arrow" size={14} /></Link>
            </div>
            <div className="run-panel">
              <div className="run-panel-icon"><Icon name="play" size={18} /></div>
              <p className="overline">READY TO EDIT</p>
              <h3>{batches.length || "—"} {batches.length === 1 ? "batch" : "batches"}</h3>
              <p>Each batch goes through Normalize, Format, and Edit. Progress appears in a proceeding popup — not an alert.</p>
              <div className="kind-toggle" role="group" aria-label="Run kind">
                <button type="button" className={kind === "demo" ? "active" : ""} onClick={() => setKind("demo")}>Demo · {cap} words</button>
                <button
                  type="button"
                  className={kind === "job" ? "active" : ""}
                  onClick={() => {
                    if (!account.canBookJob) {
                      setOverlayOpen(true);
                      setOverlayBusy(false);
                      setOverlayTitle("Jobs require approval");
                      setOverlayError({ message: `Your status is ${account.status.replace("_", " ")}. An admin has to set it to approved before you can book a job.`, retryable: false });
                      return;
                    }
                    setKind("job");
                  }}
                >
                  Book a job
                </button>
              </div>
              {overCap && <p className="cap-note">Demo will use the first {cap} words. Extra wording waits until this account is approved.</p>}
              <button className="primary-button run-button" onClick={() => void runWorkflow("fresh")} disabled={!config.transcript.trim()}>
                <span>{kind === "demo" ? "Run demo" : "Book this job"}</span>
                <Icon name="arrow" size={15} />
              </button>
            </div>
          </aside>
        </section>
      )}

      {showCanvas && job && (
        <section className="review-view">
          <div className="review-heading">
            <div>
              <p className="overline">{job.status === "complete" ? "EDIT COMPLETE" : job.status.toUpperCase()}</p>
              <h2>Complete edits canvas.</h2>
              <p>Copy or paste any stage. Request changes, continue a stopped run, or start a new transcript — this one stays in history.</p>
            </div>
            <div className="review-actions">
              {(job.status === "failed" || job.status === "paused") && (
                <button className="primary-button" onClick={() => void runWorkflow("retry")}><Icon name="refresh" size={15} />Continue</button>
              )}
              <button className="quiet-button" onClick={() => void runWorkflow("fresh")}><Icon name="refresh" size={15} />Run again</button>
              <CopyButton text={job.result || job.stages.edit} label="Copy final" />
              <button className="quiet-button" onClick={downloadText}><Icon name="download" size={15} />TXT</button>
              <button className="primary-button" onClick={downloadPdf}><Icon name="download" size={15} />PDF</button>
            </div>
          </div>
          <EditsCanvas job={job} onChangePart={onChangePart} />
          <div className="review-grid canvas-follow">
            <div className="card check-card">
              <div className="card-topline">
                <div>
                  <p className="overline">QUALITY CHECK</p>
                  <h3>Does it hold up?</h3>
                </div>
                <Icon name="check" size={17} />
              </div>
              <p>Scan sections for unresolved markers, repetition, and punctuation issues without changing the text.</p>
              <button className="secondary-button" onClick={() => void runCrossCheck()} disabled={checking}>
                {checking ? <><span className="spinner dark" />Checking</> : <><Icon name="activity" size={15} />{(job.crossChecks || []).length ? "Run again" : "Cross-check sections"}</>}
              </button>
              {(job.crossChecks || []).length > 0 && (
                <div className="check-result">
                  <strong>{flaggedChecks ? "Human review needed" : "Looks clean"}</strong>
                  <span><b>{passedChecks}</b> passed · <b>{flaggedChecks}</b> to review</span>
                </div>
              )}
            </div>
            <div className="card refine-card">
              <p className="overline">REQUEST CHANGES</p>
              <h3>Refine this edit</h3>
              <p>Describe the adjustment. The refine pass starts from the current edited (or already refined) text.</p>
              <textarea value={refineInstruction} onChange={(event) => setRefineInstruction(event.target.value)} placeholder="e.g. Keep the joke, tighten speaker labels, do not summarize." />
              <button className="primary-button" onClick={() => void runRefine()} disabled={overlayBusy}>Apply refine pass</button>
            </div>
            <div className="card handoff-card">
              <p className="overline">NEXT</p>
              <h3>Start a new transcript</h3>
              <p>This canvas stays in history. Open guiding rules if the next source needs a different contract.</p>
              <Link href="/workspace" className="card-link">New transcript <Icon name="arrow" size={14} /></Link>
              <Link href="/settings" className="card-link">Adjust guiding rules <Icon name="arrow" size={14} /></Link>
            </div>
          </div>
          {job.errorLog.length > 0 && (
            <div className="error-log card">
              <p className="overline">ERROR LOG</p>
              {job.errorLog.slice(-8).map((event) => (
                <div className="trace-mini-row error" key={event.id}>
                  <span className="trace-mini-dot" />
                  <span>{event.message}</span>
                  <small>{event.stage}{event.batch ? ` · batch ${event.batch}` : ""}</small>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <footer className="workspace-footer">
        <span>Source stays in your private workspace.</span>
        <span>{account.canBookJob ? "Approved accounts can book full jobs." : `Demo cap ${cap} words until approval.`}</span>
      </footer>

      <ProceedingOverlay
        open={overlayOpen}
        title={overlayTitle}
        subtitle={overlaySubtitle}
        percent={overlayPercent}
        summaryLeft={summaryLeft}
        summaryRight={summaryRight}
        steps={overlaySteps}
        log={overlayLog}
        error={overlayError}
        busy={overlayBusy}
        onRetry={() => void runWorkflow("retry")}
        onContinue={() => {
          pauseRef.current = true;
          setOverlayOpen(false);
          if (jobRef.current) void persist({ ...jobRef.current, status: "paused", updatedAt: new Date().toISOString() });
        }}
        onPause={() => {
          pauseRef.current = true;
        }}
        onClose={() => setOverlayOpen(false)}
      />
    </main>
  );
}
