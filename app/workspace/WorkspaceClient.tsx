'use client';

import JSZip from "jszip";
import { jsPDF } from "jspdf";
import Link from "next/link";
import { ChangeEvent, DragEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  chunkTranscript,
  DEFAULT_CONFIG,
  estimateTokens,
  formatNumber,
  makeId,
  normalizeConfig,
  PIPELINE,
  sectionChecks,
  shortModel,
  slugify,
  type Progress,
  type SectionCheck,
  type TraceEvent,
  type WorkflowConfig,
} from "../../lib/workflow";

type RunState = "idle" | "running" | "complete";
type Notice = { tone: "success" | "error" | "info"; message: string };

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true } as const;
  const stroke = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "upload") return <svg {...common}><path {...stroke} d="M12 16V4M8 8l4-4 4 4M5 14v5h14v-5" /></svg>;
  if (name === "file") return <svg {...common}><path {...stroke} d="M6 3.5h8l4 4v13H6v-17Z" /><path {...stroke} d="M14 3.5v4h4M9 12h6M9 15.5h6" /></svg>;
  if (name === "play") return <svg {...common}><path d="M8.5 5.5v13l10-6.5-10-6.5Z" fill="currentColor" /></svg>;
  if (name === "arrow") return <svg {...common}><path {...stroke} d="M5 12h13M13 6l6 6-6 6" /></svg>;
  if (name === "check") return <svg {...common}><path {...stroke} d="m5 12 4 4L19 6" /></svg>;
  if (name === "alert") return <svg {...common}><path {...stroke} d="M12 4 21 20H3L12 4Z" /><path {...stroke} d="M12 9v5M12 17.5h.01" /></svg>;
  if (name === "copy") return <svg {...common}><rect {...stroke} x="8" y="8" width="11" height="12" rx="1.5" /><path {...stroke} d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v10A1.5 1.5 0 0 0 5.5 17H8" /></svg>;
  if (name === "download") return <svg {...common}><path {...stroke} d="M12 4v12M8 12l4 4 4-4M5 20h14" /></svg>;
  if (name === "refresh") return <svg {...common}><path {...stroke} d="M20 11a8 8 0 0 0-14.5-4.7L4 8M4 4v4h4M4 13a8 8 0 0 0 14.5 4.7L20 16m0 4v-4h-4" /></svg>;
  if (name === "external") return <svg {...common}><path {...stroke} d="M14 5h5v5M19 5l-8 8M19 13v5.5a.5.5 0 0 1-.5.5h-13a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5H11" /></svg>;
  if (name === "chevron") return <svg {...common}><path {...stroke} d="m9 6 6 6-6 6" /></svg>;
  if (name === "x") return <svg {...common}><path {...stroke} d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "spark") return <svg {...common}><path {...stroke} d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z" /></svg>;
  if (name === "activity") return <svg {...common}><path {...stroke} d="M3 12h4l2.1-6 4.2 12 2.1-6H21" /></svg>;
  if (name === "layers") return <svg {...common}><path {...stroke} d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" /><path {...stroke} d="m4 12 8 4.5 8-4.5M4 16.5l8 4.5 8-4.5" /></svg>;
  if (name === "edit") return <svg {...common}><path {...stroke} d="m4 16.5-.8 3.8 3.8-.8L18.7 7.8a2.7 2.7 0 0 0-3.8-3.8L4 16.5Z" /><path {...stroke} d="m13.5 5.5 5 5" /></svg>;
  return <svg {...common}><circle {...stroke} cx="12" cy="12" r="8" /></svg>;
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

function timeLabel(timestamp: string) {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function WorkspaceClient() {
  const [config, setConfig] = useState<WorkflowConfig>({ ...DEFAULT_CONFIG, fallbackModels: [...DEFAULT_CONFIG.fallbackModels] });
  const [result, setResult] = useState("");
  const [crossChecks, setCrossChecks] = useState<SectionCheck[]>([]);
  const [trace, setTrace] = useState<TraceEvent[]>([]);
  const [progress, setProgress] = useState<Progress>({ stage: "idle", stageIndex: -1, batch: 0, total: 0 });
  const [runState, setRunState] = useState<RunState>("idle");
  const [checking, setChecking] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [error, setError] = useState("");
  const serverSaveOkRef = useRef(false);
  const transcriptInputRef = useRef<HTMLInputElement>(null);

  const batches = useMemo(() => chunkTranscript(config.transcript, config.batchTokens), [config.transcript, config.batchTokens]);
  const inputTokens = useMemo(() => estimateTokens(config.transcript), [config.transcript]);
  const outputTokens = useMemo(() => estimateTokens(result), [result]);
  const passedChecks = crossChecks.filter((check) => check.status === "pass").length;
  const flaggedChecks = crossChecks.filter((check) => check.status === "review").length;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      let localPayload: { config?: unknown; result?: string; crossChecks?: SectionCheck[] } | null = null;
      try {
        const local = localStorage.getItem("transcripter-workflow-v2");
        if (local) localPayload = JSON.parse(local);
      } catch { /* use server state */ }
      try {
        const response = await fetch("/api/workflow", { cache: "no-store" });
        const data = (await response.json()) as {
          workflow?: { config?: unknown; result?: string; crossChecks?: SectionCheck[] } | null;
          database?: { configured?: boolean; error?: string };
        };
        const payload = data.workflow || localPayload;
        if (!cancelled && payload) {
          setConfig(normalizeConfig(payload.config));
          setResult(typeof payload.result === "string" ? payload.result : "");
          setCrossChecks(Array.isArray(payload.crossChecks) ? payload.crossChecks : []);
        }
        if (!cancelled && data.database && !data.database.configured) {
          setNotice({ tone: "info", message: "Server saving is off — set DATABASE_URL to store this workflow in your Neon database. Until then, changes stay in this browser." });
        } else if (!cancelled && data.database?.error) {
          setNotice({ tone: "error", message: `Database: ${data.database.error}` });
        }
      } catch {
        if (!cancelled && localPayload) {
          setConfig(normalizeConfig(localPayload.config));
          setResult(typeof localPayload.result === "string" ? localPayload.result : "");
          setCrossChecks(Array.isArray(localPayload.crossChecks) ? localPayload.crossChecks : []);
        }
      } finally {
        if (!cancelled) setHydrated(true);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const payload = { config, result, crossChecks };
    try { localStorage.setItem("transcripter-workflow-v2", JSON.stringify(payload)); } catch { /* server persistence remains available */ }
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const response = await fetch("/api/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
          const data = (await response.json()) as { persisted?: boolean; configured?: boolean; error?: string };
          if (data.persisted) {
            serverSaveOkRef.current = true;
          } else if (data.configured && data.error && serverSaveOkRef.current) {
            // Only alert when saving used to work — a never-configured
            // database is already explained by the load-time notice.
            setNotice({ tone: "error", message: `Server save failed: ${data.error}` });
          }
        } catch { /* the draft stays in the browser when the server is unreachable */ }
      })();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [config, result, crossChecks, hydrated]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4800);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const updateConfig = useCallback(<K extends keyof WorkflowConfig>(key: K, value: WorkflowConfig[K]) => {
    setConfig((current) => ({ ...current, [key]: value }));
  }, []);

  const addTrace = useCallback((event: Omit<TraceEvent, "id" | "timestamp">) => {
    setTrace((current) => [{ ...event, id: makeId(), timestamp: new Date().toISOString() }, ...current]);
  }, []);

  const updateTrace = useCallback((id: string, patch: Partial<TraceEvent>) => {
    setTrace((current) => current.map((event) => event.id === id ? { ...event, ...patch } : event));
  }, []);

  const readFile = useCallback(async (file: File) => {
    const isZip = file.name.toLowerCase().endsWith(".zip") || file.type === "application/zip";
    if (!isZip) return { text: await file.text(), name: file.name };
    const zip = await JSZip.loadAsync(file);
    const names = Object.keys(zip.files);
    const entryName = names.find((name) => !zip.files[name].dir && name.split("/").pop()?.toLowerCase() === "v.txt") || names.find((name) => !zip.files[name].dir && /\.(txt|md|markdown)$/i.test(name));
    if (!entryName || !zip.file(entryName)) throw new Error("The ZIP must contain V.txt or a text/markdown file.");
    return { text: await zip.file(entryName)!.async("text"), name: `${file.name} → ${entryName}` };
  }, []);

  const handleFile = useCallback(async (file?: File) => {
    if (!file) return;
    try {
      const loaded = await readFile(file);
      updateConfig("transcript", loaded.text);
      updateConfig("sourceFileName", loaded.name);
      setResult("");
      setCrossChecks([]);
      setRunState("idle");
      setError("");
      setNotice({ tone: "success", message: `${loaded.name} is loaded.` });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "This file could not be opened.");
    }
  }, [readFile, updateConfig]);

  const onFileInput = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    void handleFile(event.target.files?.[0]);
    event.target.value = "";
  }, [handleFile]);

  const onDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    void handleFile(event.dataTransfer.files?.[0]);
  }, [handleFile]);

  const runWorkflow = useCallback(async () => {
    if (runState === "running") return;
    if (!config.transcript.trim()) {
      setError("Add a transcript before starting the edit.");
      return;
    }
    const safeBatches = chunkTranscript(config.transcript, config.batchTokens);
    if (!safeBatches.length) return;
    setError("");
    setNotice(null);
    setTrace([]);
    setResult("");
    setCrossChecks([]);
    setRunState("running");
    setProgress({ stage: "normalize", stageIndex: 0, batch: 0, total: safeBatches.length });
    addTrace({ stage: "planner", label: "Source planned", status: "success", total: safeBatches.length, message: `${formatNumber(safeBatches.length)} batch${safeBatches.length === 1 ? "" : "es"} · ${formatNumber(estimateTokens(config.transcript))} input tokens` });
    const outputs: string[] = [];
    let continuity = "";
    const startedAt = Date.now();

    try {
      for (let batchIndex = 0; batchIndex < safeBatches.length; batchIndex += 1) {
        let currentText = safeBatches[batchIndex];
        for (let stageIndex = 0; stageIndex < PIPELINE.length; stageIndex += 1) {
          const stage = PIPELINE[stageIndex];
          setProgress({ stage: stage.key, stageIndex, batch: batchIndex, total: safeBatches.length });
          const traceId = makeId();
          const stageStarted = Date.now();
          setTrace((current) => [{ id: traceId, stage: stage.key, label: stage.label, status: "running", batch: batchIndex + 1, total: safeBatches.length, timestamp: new Date().toISOString(), message: "Processing one editorial pass" }, ...current]);
          try {
            const response = await fetch("/api/process", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ stage: stage.key, text: currentText, masterPrompt: config.masterPrompt, formatRules: config.formatRules, editRules: config.editRules, model: config.primaryModel, fallbackModels: config.fallbackModels, contextWindow: config.contextWindow, maxOutputTokens: config.maxOutputTokens, temperature: config.temperature, batch: { index: batchIndex, total: safeBatches.length }, contextBefore: continuity }),
            });
            const data = (await response.json()) as { ok?: boolean; output?: string; error?: string; modelUsed?: string; demo?: boolean; warning?: string; attempts?: { model: string; error: string }[] };
            if (!response.ok || !data.ok || !data.output?.trim()) {
              const attempts = data.attempts?.length ? ` ${data.attempts.map((attempt) => `${shortModel(attempt.model)}: ${attempt.error}`).join(" | ")}` : "";
              throw new Error(`${data.error || "This pass did not return an output."}${attempts}`);
            }
            currentText = data.output.trim();
            updateTrace(traceId, { status: "success", duration: Date.now() - stageStarted, model: data.modelUsed || config.primaryModel, demo: data.demo, message: data.warning || (data.modelUsed !== config.primaryModel ? "Alternative model used" : "Pass completed") });
          } catch (caught) {
            const message = caught instanceof Error ? caught.message : "The editorial pass failed.";
            updateTrace(traceId, { status: "error", duration: Date.now() - stageStarted, model: config.primaryModel, message });
            throw new Error(`Batch ${batchIndex + 1}, ${stage.label}: ${message}`);
          }
        }
        outputs.push(currentText);
        continuity = currentText.slice(-Math.max(0, config.overlapTokens) * 4);
      }
      const edited = outputs.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
      setResult(edited);
      setProgress({ stage: "idle", stageIndex: PIPELINE.length, batch: safeBatches.length, total: safeBatches.length });
      addTrace({ stage: "complete", label: "Edit assembled", status: "success", batch: safeBatches.length, total: safeBatches.length, duration: Date.now() - startedAt, message: `${formatNumber(estimateTokens(edited))} output tokens` });
      setRunState("complete");
      setNotice({ tone: "success", message: "Your edited transcript is ready to review." });
    } catch (caught) {
      setRunState("idle");
      setError(caught instanceof Error ? caught.message : "The edit stopped unexpectedly.");
      addTrace({ stage: "workflow", label: "Edit stopped", status: "error", message: "No partial output was assembled." });
    }
  }, [addTrace, config, runState, updateTrace]);

  const runCrossCheck = useCallback(async () => {
    if (!result || checking) return;
    setChecking(true);
    await new Promise((resolve) => window.setTimeout(resolve, 300));
    const checks = sectionChecks(result);
    setCrossChecks(checks);
    setChecking(false);
    setNotice({ tone: checks.some((check) => check.status === "review") ? "info" : "success", message: checks.some((check) => check.status === "review") ? "A few sections need a human look." : "Every section passed the review scan." });
  }, [checking, result]);

  const copyResult = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setNotice({ tone: "success", message: "Edited transcript copied." });
    } catch { setNotice({ tone: "info", message: "Copy is not available in this browser." }); }
  }, [result]);

  const downloadText = useCallback(() => {
    if (!result) return;
    downloadBlob(new Blob([result], { type: "text/plain;charset=utf-8" }), `${slugify(config.name)}.txt`);
  }, [config.name, result]);

  const downloadPdf = useCallback(() => {
    if (!result) return;
    const pdf = new jsPDF({ unit: "pt", format: "letter" });
    const margin = 54;
    const width = pdf.internal.pageSize.getWidth() - margin * 2;
    const bottom = pdf.internal.pageSize.getHeight() - margin;
    pdf.setTextColor(27, 40, 40);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    pdf.text(config.name || "Edited transcript", margin, margin);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.setTextColor(110, 123, 122);
    pdf.text(`Transcripter · ${new Date().toLocaleDateString()}`, margin, margin + 16);
    pdf.setTextColor(35, 48, 48);
    pdf.setFontSize(10.5);
    const lines = pdf.splitTextToSize(result, width) as string[];
    let y = margin + 48;
    lines.forEach((line) => { if (y > bottom) { pdf.addPage(); y = margin; } pdf.text(line, margin, y); y += 15; });
    pdf.save(`${slugify(config.name)}.pdf`);
  }, [config.name, result]);

  const exportWorkflow = useCallback(() => {
    downloadBlob(new Blob([JSON.stringify({ type: "transcripter-workflow", version: 2, exportedAt: new Date().toISOString(), config, result, crossChecks }, null, 2)], { type: "application/json" }), `${slugify(config.name)}.workflow.json`);
    setNotice({ tone: "success", message: "Workflow exported." });
  }, [config, crossChecks, result]);

  const importWorkflow = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    file.text().then((raw) => {
      try {
        const payload = JSON.parse(raw) as { config?: unknown; result?: string; crossChecks?: SectionCheck[] };
        setConfig(normalizeConfig(payload.config || payload));
        setResult(typeof payload.result === "string" ? payload.result : "");
        setCrossChecks(Array.isArray(payload.crossChecks) ? payload.crossChecks : []);
        setRunState(payload.result ? "complete" : "idle");
        setNotice({ tone: "success", message: "Workflow imported." });
      } catch { setError("That file is not a valid workflow export."); }
    });
  }, []);

  const stagePercent = runState === "complete" ? 100 : progress.total ? Math.max(4, Math.round(((progress.batch * PIPELINE.length + Math.max(progress.stageIndex, 0)) / (progress.total * PIPELINE.length)) * 100)) : 0;

  return <main className="workspace-page">
    <header className="page-header workspace-header"><div><p className="overline">NEW EDIT</p><h1>Start with the source.</h1><p className="page-subtitle">Bring in a transcript. The workspace will move it through your saved editorial direction, one controlled pass at a time.</p></div><div className="header-actions"><Link className="text-link" href="/settings">Open settings <Icon name="arrow" size={15} /></Link><button className="quiet-button" onClick={exportWorkflow} disabled={!config.transcript}><Icon name="download" size={15} />Export</button></div></header>
    {notice && <div className={`workspace-notice ${notice.tone}`}><Icon name={notice.tone === "error" ? "alert" : notice.tone === "success" ? "check" : "spark"} size={16} /><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" size={15} /></button></div>}
    {error && <div className="workspace-error" role="alert"><Icon name="alert" size={17} /><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><Icon name="x" size={15} /></button></div>}

    {runState === "idle" && <section className="intake-layout">
      <div className="intake-main">
        <div className="card card-source">
          <div className="card-topline"><div><p className="overline">SOURCE</p><h2>What are we editing?</h2></div><span className="step-label">01 / 01</span></div>
          <div className="source-input-wrap"><textarea value={config.transcript} onChange={(event) => { updateConfig("transcript", event.target.value); setError(""); }} placeholder="Paste your transcript here…" aria-label="Transcript source" spellCheck={false} /><div className="source-meta"><span>{config.transcript ? `${formatNumber(config.transcript.length)} characters` : "Paste or upload a transcript"}</span><span>{config.transcript ? `${formatNumber(inputTokens)} estimated tokens` : "TXT, MD, or V.txt ZIP"}</span></div></div>
          <div className="upload-row" onClick={() => transcriptInputRef.current?.click()} onDrop={onDrop} onDragOver={(event) => event.preventDefault()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") transcriptInputRef.current?.click(); }}><input ref={transcriptInputRef} className="visually-hidden" type="file" accept=".txt,.md,.markdown,.zip,text/plain,application/zip" onChange={onFileInput} /><span className="upload-icon"><Icon name="upload" size={17} /></span><span><strong>Drop a file here</strong><small>V.txt is selected automatically inside ZIP files</small></span><span className="upload-browse">Browse <Icon name="chevron" size={13} /></span></div>
        </div>
        <div className="source-footer"><div className="source-file"><Icon name="file" size={15} /><span>{config.sourceFileName || "Untitled source"}</span></div><label className="import-label">Import workflow<input className="visually-hidden" type="file" accept="application/json,.json" onChange={importWorkflow} /></label></div>
      </div>
      <aside className="intake-side">
        <div className="card direction-card"><div className="card-topline"><p className="overline">EDITORIAL DIRECTION</p><Icon name="edit" size={17} /></div><h3>{config.name}</h3><p>{config.description || "Saved rules will shape each pass. Change the direction in Settings."}</p><div className="direction-pills"><span><i />Format rules</span><span><i />Edit rules</span><span><i />Master prompt</span></div><Link href="/settings" className="card-link">Review direction <Icon name="arrow" size={14} /></Link></div>
        <div className="run-panel"><div className="run-panel-icon"><Icon name="play" size={18} /></div><div><p className="overline">READY TO EDIT</p><h3>{batches.length || "—"} {batches.length === 1 ? "batch" : "batches"}</h3><p>Each batch goes through Normalize, Format, and Edit.</p></div><button className="primary-button run-button" onClick={runWorkflow} disabled={!config.transcript.trim()}><span>Run edit</span><Icon name="arrow" size={15} /></button></div>
      </aside>
    </section>}

    {runState === "running" && <RunView progress={progress} progressPercent={stagePercent} trace={trace} batchCount={batches.length} />}
    {runState === "complete" && <ReviewView result={result} outputTokens={outputTokens} crossChecks={crossChecks} passedChecks={passedChecks} flaggedChecks={flaggedChecks} checking={checking} runCrossCheck={runCrossCheck} copyResult={copyResult} downloadText={downloadText} downloadPdf={downloadPdf} onRunAgain={() => setRunState("idle")} />}

    <footer className="workspace-footer"><span>Source stays in your private workspace.</span><span>Rules are applied consistently across every batch.</span></footer>
  </main>;
}

function RunView({ progress, progressPercent, trace, batchCount }: { progress: Progress; progressPercent: number; trace: TraceEvent[]; batchCount: number }) {
  return <section className="run-view"><div className="run-view-heading"><div><p className="overline">IN PROGRESS</p><h2>Working through your source.</h2><p>Each pass is isolated, traced, and handed to the next pass only after it completes.</p></div><div className="run-percent"><strong>{progressPercent}</strong><span>%</span></div></div><div className="progress-track"><span style={{ width: `${progressPercent}%` }} /></div><div className="run-summary"><span>{progress.batch + 1} of {batchCount} batches</span><span>{PIPELINE[progress.stageIndex]?.label || "Preparing"}</span></div><div className="process-list">{PIPELINE.map((stage, index) => { const status = progress.stageIndex > index ? "done" : progress.stageIndex === index ? "active" : "waiting"; return <div className={`process-row ${status}`} key={stage.key}><span className="process-number">{status === "done" ? <Icon name="check" size={14} /> : String(index + 1).padStart(2, "0")}</span><div><strong>{stage.label}</strong><span>{stage.description}</span></div><em>{status === "done" ? "Complete" : status === "active" ? "Working" : "Queued"}</em></div>; })}</div><div className="trace-mini"><div className="trace-mini-head"><span>LIVE TRACE</span><span>{trace.length} events</span></div>{trace.slice(0, 6).map((event) => <div className={`trace-mini-row ${event.status}`} key={event.id}><span className="trace-mini-dot" /><span>{event.label}</span><small>{event.batch && event.total ? `Batch ${event.batch}/${event.total}` : event.status}</small></div>)}</div></section>;
}

function ReviewView({ result, outputTokens, crossChecks, passedChecks, flaggedChecks, checking, runCrossCheck, copyResult, downloadText, downloadPdf, onRunAgain }: { result: string; outputTokens: number; crossChecks: SectionCheck[]; passedChecks: number; flaggedChecks: number; checking: boolean; runCrossCheck: () => void; copyResult: () => void; downloadText: () => void; downloadPdf: () => void; onRunAgain: () => void }) {
  return <section className="review-view"><div className="review-heading"><div><p className="overline">EDIT COMPLETE</p><h2>Your edited transcript.</h2><p>Review the assembled version below. The source order is preserved across every batch.</p></div><div className="review-actions"><button className="quiet-button" onClick={onRunAgain}><Icon name="refresh" size={15} />Edit again</button><button className="quiet-button" onClick={copyResult}><Icon name="copy" size={15} />Copy</button><button className="quiet-button" onClick={downloadText}><Icon name="download" size={15} />TXT</button><button className="primary-button" onClick={downloadPdf}><Icon name="download" size={15} />PDF</button></div></div><div className="review-grid"><div className="card output-card"><div className="output-topline"><span><i />EDITED VERSION</span><span>{formatNumber(outputTokens)} estimated tokens</span></div><pre>{result}</pre></div><aside className="review-side"><div className="card check-card"><div className="card-topline"><div><p className="overline">QUALITY CHECK</p><h3>Does it hold up?</h3></div><Icon name="check" size={17} /></div><p>Scan sections for unresolved markers, repetition, and punctuation issues without changing the text.</p><button className="secondary-button" onClick={runCrossCheck} disabled={checking}>{checking ? <><span className="spinner dark" />Checking</> : <><Icon name="activity" size={15} />{crossChecks.length ? "Run again" : "Cross-check sections"}</>}</button>{crossChecks.length > 0 && <div className="check-result"><strong>{flaggedChecks ? "Human review needed" : "Looks clean"}</strong><span><b>{passedChecks}</b> passed · <b>{flaggedChecks}</b> to review</span></div>}</div><div className="card handoff-card"><p className="overline">NEXT</p><h3>Need another pass?</h3><p>Update your direction in Settings, then run the source again. Your original transcript remains unchanged.</p><Link href="/settings" className="card-link">Open settings <Icon name="arrow" size={14} /></Link></div></aside></div></section>;
}
