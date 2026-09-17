'use client';

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_CONFIG,
  formatNumber,
  MAX_ALTERNATIVES,
  MODEL_OPTIONS,
  normalizeConfig,
  slugify,
  type SectionCheck,
  type WorkflowConfig,
} from "../../lib/workflow";
import type { Account } from "../../lib/types";

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": true } as const;
  const stroke = { stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (name === "check") return <svg {...common}><path {...stroke} d="m5 12 4 4L19 6" /></svg>;
  if (name === "x") return <svg {...common}><path {...stroke} d="m6 6 12 12M18 6 6 18" /></svg>;
  if (name === "plus") return <svg {...common}><path {...stroke} d="M12 5v14M5 12h14" /></svg>;
  if (name === "lock") return <svg {...common}><rect {...stroke} x="5" y="10" width="14" height="10" rx="2" /><path {...stroke} d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
  if (name === "download") return <svg {...common}><path {...stroke} d="M12 4v12M8 12l4 4 4-4M5 20h14" /></svg>;
  if (name === "upload") return <svg {...common}><path {...stroke} d="M12 16V4M8 8l4-4 4 4M5 14v5h14v-5" /></svg>;
  if (name === "arrow") return <svg {...common}><path {...stroke} d="M5 12h13M13 6l6 6-6 6" /></svg>;
  if (name === "settings") return <svg {...common}><circle {...stroke} cx="12" cy="12" r="3" /><path {...stroke} d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a1.4 1.4 0 0 1-2 2l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a1.4 1.4 0 0 1-2.8 0v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a1.4 1.4 0 0 1-2-2l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1h-.2a1.4 1.4 0 0 1 0-2.8h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a1.4 1.4 0 0 1 2-2l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2a1.4 1.4 0 0 1 2.8 0v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a1.4 1.4 0 0 1 2 2l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2a1.4 1.4 0 0 1 0 2.8h-.2a1.7 1.7 0 0 0-1.5 1Z" /></svg>;
  return <svg {...common}><circle {...stroke} cx="12" cy="12" r="8" /></svg>;
}

type Notice = { tone: "success" | "error" | "info"; message: string };
type DatabaseInfo = { configured?: boolean; autoMigrations?: boolean; applied?: string[]; error?: string };

export default function SettingsClient({ account }: { account?: Account }) {
  const [config, setConfig] = useState<WorkflowConfig>({ ...DEFAULT_CONFIG, fallbackModels: [...DEFAULT_CONFIG.fallbackModels] });
  const [result, setResult] = useState("");
  const [crossChecks, setCrossChecks] = useState<SectionCheck[]>([]);
  const [database, setDatabase] = useState<DatabaseInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch("/api/workflow", { cache: "no-store" });
        const data = (await response.json()) as {
          workflow?: { config?: unknown; result?: string; crossChecks?: SectionCheck[] } | null;
          database?: DatabaseInfo;
        };
        if (!cancelled) setDatabase(data.database ?? null);
        if (!cancelled && data.workflow) {
          setConfig(normalizeConfig(data.workflow.config));
          setResult(data.workflow.result || "");
          setCrossChecks(Array.isArray(data.workflow.crossChecks) ? data.workflow.crossChecks : []);
        } else if (!cancelled) loadLocal();
      } catch {
        if (!cancelled) loadLocal();
      } finally { if (!cancelled) setReady(true); }
    }
    function loadLocal() {
      try {
        const raw = localStorage.getItem("transcripter-workflow-v2");
        if (!raw) return;
        const payload = JSON.parse(raw) as { config?: unknown; result?: string; crossChecks?: SectionCheck[] };
        setConfig(normalizeConfig(payload.config));
        setResult(payload.result || "");
        setCrossChecks(Array.isArray(payload.crossChecks) ? payload.crossChecks : []);
      } catch { /* defaults are valid */ }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const update = <K extends keyof WorkflowConfig>(key: K, value: WorkflowConfig[K]) => setConfig((current) => ({ ...current, [key]: value }));
  const updateFallback = (index: number, value: string) => setConfig((current) => { const next = [...current.fallbackModels]; while (next.length <= index) next.push(""); next[index] = value; return { ...current, fallbackModels: next }; });
  const addFallback = () => setConfig((current) => current.fallbackModels.length < MAX_ALTERNATIVES ? { ...current, fallbackModels: [...current.fallbackModels, ""] } : current);
  const removeFallback = (index: number) => setConfig((current) => ({ ...current, fallbackModels: current.fallbackModels.filter((_, itemIndex) => itemIndex !== index) }));

  async function save() {
    setSaving(true);
    const payload = { config, result, crossChecks };
    try {
      localStorage.setItem("transcripter-workflow-v2", JSON.stringify(payload));
      const response = await fetch("/api/workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await response.json()) as { persisted?: boolean; error?: string };
      if (data.persisted) {
        setNotice({ tone: "success", message: "Settings saved to your workspace." });
      } else if (data.error) {
        setNotice({ tone: "error", message: `Saved for this browser only — ${data.error}` });
      } else {
        setNotice({ tone: "info", message: "Settings saved for this browser." });
      }
    } catch {
      setNotice({ tone: "info", message: "Settings saved locally. Server persistence is not available yet." });
    } finally { setSaving(false); }
  }

  function exportWorkflow() {
    const blob = new Blob([JSON.stringify({ type: "transcripter-workflow", version: 2, exportedAt: new Date().toISOString(), config, result, crossChecks }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${slugify(config.name)}.workflow.json`; anchor.click(); URL.revokeObjectURL(url);
  }

  function importWorkflow(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    file.text().then((raw) => {
      try {
        const payload = JSON.parse(raw) as { config?: unknown; result?: string; crossChecks?: SectionCheck[] };
        setConfig(normalizeConfig(payload.config || payload)); setResult(payload.result || ""); setCrossChecks(Array.isArray(payload.crossChecks) ? payload.crossChecks : []);
        setNotice({ tone: "success", message: "Workflow settings imported. Save to make them active." });
      } catch { setNotice({ tone: "error", message: "That file is not a valid workflow export." }); }
    });
  }

  const armedAlternatives = useMemo(() => config.fallbackModels.filter(Boolean).length, [config.fallbackModels]);

  if (!ready) return <main className="settings-page"><div className="loading-state"><span className="spinner dark" />Loading settings</div></main>;

  return <main className="settings-page">
    <header className="page-header settings-header"><div><p className="overline">SETTINGS</p><h1>Shape the edit.</h1><p className="page-subtitle">Set the editorial direction once. Every new source will inherit these rules and the same quality bar.</p></div><div className="header-actions"><Link className="text-link" href="/workspace">Back to workspace <Icon name="arrow" size={15} /></Link><button className="primary-button" onClick={save} disabled={saving}>{saving ? <><span className="spinner" />Saving</> : <><Icon name="check" size={15} />Save changes</>}</button></div></header>
    {account && account.status !== "approved" && <div className="workspace-notice info"><Icon name="lock" size={16} /><span>Account status is {account.status.replace("_", " ")}. Guiding rules still apply to demos. Booking a full job waits on the approved enum.</span></div>}
    {notice && <div className={`workspace-notice ${notice.tone}`}><Icon name={notice.tone === "error" ? "x" : "check"} size={16} /><span>{notice.message}</span><button onClick={() => setNotice(null)} aria-label="Dismiss"><Icon name="x" size={15} /></button></div>}

    <div className="settings-layout">
      <aside className="settings-index"><span className="overline">CONFIGURE</span><a href="#workspace">Workspace</a><a href="#direction">Editorial direction</a><a href="#models">Models &amp; routing</a><a href="#limits">Context &amp; limits</a><a href="#handoff">Handoff</a><a href="#storage">Storage</a><div className="settings-index-note"><Icon name="lock" size={14} /><span>Changes are private to your workspace.</span></div></aside>
      <div className="settings-content">
        <section className="settings-section" id="workspace"><div className="settings-section-heading"><span className="settings-number">01</span><div><p className="overline">WORKSPACE</p><h2>Identify this edit</h2><p>Give your workflow a name that will make sense when it is shared or revisited.</p></div></div><div className="settings-fields two-col"><label>Workflow name<input value={config.name} onChange={(event) => update("name", event.target.value)} placeholder="Transcript edit" /></label><label>Description<textarea value={config.description} onChange={(event) => update("description", event.target.value)} placeholder="What kind of source is this for?" /></label></div></section>
        <section className="settings-section" id="direction"><div className="settings-section-heading"><span className="settings-number">02</span><div><p className="overline">EDITORIAL DIRECTION</p><h2>Protect the meaning</h2><p>These instructions are carried into every batch. Keep the master prompt stable; make project-specific changes in the rules.</p></div></div><div className="settings-fields"><label>Format rules<span className="field-description">Structure, labels, line breaks, and presentation.</span><textarea className="large-control" value={config.formatRules} onChange={(event) => update("formatRules", event.target.value)} /></label><label>Edit rules<span className="field-description">How much to polish, what to preserve, and what not to invent.</span><textarea className="large-control" value={config.editRules} onChange={(event) => update("editRules", event.target.value)} /></label><label>Master prompt<span className="field-description">The non-negotiable instruction prepended to Normalize, Format, and Edit.</span><textarea className="master-control" value={config.masterPrompt} onChange={(event) => update("masterPrompt", event.target.value)} /></label></div><div className="settings-callout"><Icon name="lock" size={15} /><span>This direction is included with every model call. It is never replaced by transcript content.</span></div></section>
        <section className="settings-section" id="models"><div className="settings-section-heading"><span className="settings-number">03</span><div><p className="overline">MODELS &amp; ROUTING</p><h2>Choose how the work gets done</h2><p>Models are configured here, not in the editing room. Alternatives are tried in order when a provider fails or rate-limits.</p></div></div><datalist id="settings-models">{MODEL_OPTIONS.map((model) => <option key={model} value={model} />)}</datalist><div className="settings-fields two-col"><label>Primary model<input className="mono-control" list="settings-models" value={config.primaryModel} onChange={(event) => update("primaryModel", event.target.value)} /><span className="field-description">First choice for every editorial pass.</span></label><div className="alternative-list"><div className="alternative-title"><span>Alternative models</span><strong>{armedAlternatives}/{MAX_ALTERNATIVES} active</strong></div>{config.fallbackModels.map((model, index) => <div className="alternative-row" key={`alternative-${index}`}><span>{String(index + 1).padStart(2, "0")}</span><input className="mono-control" list="settings-models" value={model} onChange={(event) => updateFallback(index, event.target.value)} placeholder="model/provider-id" aria-label={`Alternative model ${index + 1}`} /><button type="button" onClick={() => removeFallback(index)} aria-label={`Remove alternative model ${index + 1}`}><Icon name="x" size={14} /></button></div>)}<button type="button" className="add-alternative" onClick={addFallback} disabled={config.fallbackModels.length >= MAX_ALTERNATIVES}><Icon name="plus" size={14} />Add alternative model</button></div></div></section>
        <section className="settings-section" id="limits"><div className="settings-section-heading"><span className="settings-number">04</span><div><p className="overline">CONTEXT &amp; LIMITS</p><h2>Keep every call inside the window</h2><p>The planner estimates four characters per token and keeps continuity context separate from the output.</p></div></div><div className="settings-fields limits-grid"><label>Context window<select value={config.contextWindow} onChange={(event) => update("contextWindow", Number(event.target.value))}><option value={8192}>8,192 tokens</option><option value={16384}>16,384 tokens</option><option value={32768}>32,768 tokens</option><option value={65536}>65,536 tokens</option><option value={131072}>131,072 tokens</option></select></label><label>Batch target<input type="number" min={400} max={20000} value={config.batchTokens} onChange={(event) => update("batchTokens", Math.min(20000, Math.max(400, Number(event.target.value) || 400)))} /><span className="field-description">Smaller batches preserve more local context.</span></label><label>Continuity overlap<input type="number" min={0} max={1000} value={config.overlapTokens} onChange={(event) => update("overlapTokens", Math.min(1000, Math.max(0, Number(event.target.value) || 0)))} /><span className="field-description">Reference only; never duplicated.</span></label><label>Max output tokens<input type="number" min={256} max={16000} value={config.maxOutputTokens} onChange={(event) => update("maxOutputTokens", Math.min(16000, Math.max(256, Number(event.target.value) || 256)))} /></label><label className="temperature-setting">Temperature<div className="temperature-control"><input type="range" min="0" max="1" step="0.05" value={config.temperature} onChange={(event) => update("temperature", Number(event.target.value))} /><output>{config.temperature.toFixed(2)}</output></div></label></div></section>
        <section className="settings-section" id="handoff"><div className="settings-section-heading"><span className="settings-number">05</span><div><p className="overline">HANDOFF</p><h2>Take the workflow with you</h2><p>Export the rules and current output as a portable JSON file, or import one from a teammate.</p></div></div><div className="handoff-actions"><button className="secondary-button" onClick={exportWorkflow}><Icon name="download" size={15} />Export workflow</button><label className="secondary-button"><Icon name="upload" size={15} />Import workflow<input className="visually-hidden" type="file" accept="application/json,.json" onChange={importWorkflow} /></label></div></section>
        <section className="settings-section" id="storage"><div className="settings-section-heading"><span className="settings-number">06</span><div><p className="overline">STORAGE</p><h2>Where work is saved</h2><p>Your workflow, latest output, and cross-checks are stored by account email in the workspace database. Schema migrations apply automatically on first use.</p></div></div>
          {database && database.configured && !database.error && database.autoMigrations === false && <div className="settings-callout"><Icon name="lock" size={15} /><span>Connected (manual migration mode). Run <code>npm run db:migrate</code> to bring the schema up to date.</span></div>}
          {database && database.configured && !database.error && database.autoMigrations !== false && <div className="settings-callout"><Icon name="check" size={15} /><span>Connected — schema is up to date ({(database.applied || []).length} migration{(database.applied || []).length === 1 ? "" : "s"} applied). Saving works across devices.</span></div>}
          {database && database.configured && database.error && <div className="settings-callout error"><Icon name="x" size={15} /><span>The database is configured but the app could not reach it: {database.error}</span></div>}
          {database && !database.configured && <div className="settings-callout warn"><Icon name="lock" size={15} /><span>No database configured — changes are saved in this browser only. Set <code>DATABASE_URL</code> in the deployment environment to store work in your Neon database.</span></div>}
          {!database && <div className="settings-callout"><Icon name="lock" size={15} /><span>Reload this page to report the database status.</span></div>}
        </section>
      </div>
    </div>
  </main>;
}
