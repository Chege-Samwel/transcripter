'use client';

import Link from "next/link";
import { ChangeEvent, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_CONFIG,
  DEFAULT_TEMPLATES,
  formatNumber,
  MAX_ALTERNATIVES,
  MODEL_OPTIONS,
  normalizeConfig,
  normalizeOutputGuide,
  slugify,
  type OutputGuide,
  type OutputGuideCheck,
  type SectionCheck,
  type WorkflowConfig,
  type WorkflowTemplate,
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
  if (name === "book") return <svg {...common}><path {...stroke} d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path {...stroke} d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>;
  if (name === "trash") return <svg {...common}><path {...stroke} d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
  if (name === "copy") return <svg {...common}><rect {...stroke} x="9" y="9" width="13" height="13" rx="2" /><path {...stroke} d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
  if (name === "spark") return <svg {...common}><path {...stroke} d="m12 3 1.9 4.8L19 9.5l-4 3.7.9 5.3L12 16l-3.9 2.5.9-5.3-4-3.7 5.1-1.7L12 3Z" /></svg>;
  return <svg {...common}><circle {...stroke} cx="12" cy="12" r="8" /></svg>;
}

type Notice = { tone: "success" | "error" | "info"; message: string };

export default function SettingsClient({ account }: { account?: Account }) {
  const isAdmin = account?.role === "admin";
  const [config, setConfig] = useState<WorkflowConfig>({
    ...DEFAULT_CONFIG,
    outputGuide: { ...DEFAULT_CONFIG.outputGuide, checks: [...DEFAULT_CONFIG.outputGuide.checks] },
    fallbackModels: [...DEFAULT_CONFIG.fallbackModels],
  });
  const [result, setResult] = useState("");
  const [crossChecks, setCrossChecks] = useState<SectionCheck[]>([]);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingModels, setSavingModels] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  // Template workflow library & drafting
  const [templates, setTemplates] = useState<WorkflowTemplate[]>(DEFAULT_TEMPLATES);
  const [activeTemplateId, setActiveTemplateId] = useState<string>("tpl-standard-editorial");
  const [isDraftingTemplate, setIsDraftingTemplate] = useState(false);
  const [templateDraft, setTemplateDraft] = useState<Partial<WorkflowTemplate>>({
    name: "New Custom Template",
    description: "Tailored editorial rules and output guidance for specialized transcripts.",
    category: "Custom",
    formatRules: config.formatRules,
    editRules: config.editRules,
    masterPrompt: config.masterPrompt,
    outputGuide: { ...config.outputGuide },
  });

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [wfRes, tplRes] = await Promise.all([
          fetch("/api/workflow", { cache: "no-store" }),
          fetch("/api/templates", { cache: "no-store" }),
        ]);

        const wfData = (await wfRes.json()) as {
          workflow?: { config?: unknown; result?: string; crossChecks?: SectionCheck[] } | null;
        };
        const tplData = (await tplRes.json()) as { templates?: WorkflowTemplate[] };

        if (!cancelled && Array.isArray(tplData.templates) && tplData.templates.length) {
          setTemplates(tplData.templates);
        }

        if (!cancelled && wfData.workflow) {
          const loadedCfg = normalizeConfig(wfData.workflow.config);
          setConfig(loadedCfg);
          setResult(wfData.workflow.result || "");
          setCrossChecks(Array.isArray(wfData.workflow.crossChecks) ? wfData.workflow.crossChecks : []);
          if (loadedCfg.templateId) setActiveTemplateId(loadedCfg.templateId);
        } else if (!cancelled) {
          loadLocal();
        }
      } catch {
        if (!cancelled) loadLocal();
      } finally {
        if (!cancelled) setReady(true);
      }
    }

    function loadLocal() {
      try {
        const raw = localStorage.getItem("transcripter-workflow-v2");
        if (!raw) return;
        const payload = JSON.parse(raw) as { config?: unknown; result?: string; crossChecks?: SectionCheck[] };
        const loadedCfg = normalizeConfig(payload.config);
        setConfig(loadedCfg);
        setResult(payload.result || "");
        setCrossChecks(Array.isArray(payload.crossChecks) ? payload.crossChecks : []);
        if (loadedCfg.templateId) setActiveTemplateId(loadedCfg.templateId);
      } catch {
        /* valid */
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const update = <K extends keyof WorkflowConfig>(key: K, value: WorkflowConfig[K]) =>
    setConfig((current) => ({ ...current, [key]: value }));

  const updateOutputGuide = <K extends keyof OutputGuide>(key: K, value: OutputGuide[K]) =>
    setConfig((current) => ({
      ...current,
      outputGuide: { ...current.outputGuide, [key]: value },
    }));

  const updateFallback = (index: number, value: string) =>
    setConfig((current) => {
      const next = [...current.fallbackModels];
      while (next.length <= index) next.push("");
      next[index] = value;
      return { ...current, fallbackModels: next };
    });

  const addFallback = () =>
    setConfig((current) =>
      current.fallbackModels.length < MAX_ALTERNATIVES
        ? { ...current, fallbackModels: [...current.fallbackModels, ""] }
        : current
    );

  const removeFallback = (index: number) =>
    setConfig((current) => ({
      ...current,
      fallbackModels: current.fallbackModels.filter((_, itemIndex) => itemIndex !== index),
    }));

  async function save() {
    setSaving(true);
    const payload = { config, result, crossChecks };
    try {
      localStorage.setItem("transcripter-workflow-v2", JSON.stringify(payload));
      const response = await fetch("/api/workflow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await response.json()) as { persisted?: boolean; error?: string };
      if (data.persisted) {
        setNotice({ tone: "success", message: "Workflow direction saved to your workspace." });
      } else if (data.error) {
        setNotice({ tone: "error", message: `Saved for this browser only — ${data.error}` });
      } else {
        setNotice({ tone: "info", message: "Workflow saved for this browser." });
      }
    } catch {
      setNotice({ tone: "info", message: "Workflow saved locally." });
    } finally {
      setSaving(false);
    }
  }

  // Admin-only Save Models
  async function saveAdminModels() {
    if (!isAdmin) return;
    setSavingModels(true);
    try {
      const response = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          primaryModel: config.primaryModel.trim(),
          fallbackModels: config.fallbackModels.filter(Boolean),
        }),
      });
      const data = (await response.json()) as { ok?: boolean; message?: string; error?: string };
      if (data.ok) {
        setNotice({
          tone: "success",
          message: data.message || "System models saved. These models are now active for everyone across the platform.",
        });
      } else {
        setNotice({ tone: "error", message: data.error || "Could not update system models." });
      }
    } catch {
      setNotice({ tone: "error", message: "Could not reach the server to update models." });
    } finally {
      setSavingModels(false);
    }
  }

  // Template handling
  function applyTemplate(tpl: WorkflowTemplate) {
    setActiveTemplateId(tpl.id);
    setConfig((curr) => ({
      ...curr,
      templateId: tpl.id,
      formatRules: tpl.formatRules,
      editRules: tpl.editRules,
      masterPrompt: tpl.masterPrompt,
      outputGuide: { ...tpl.outputGuide, checks: [...tpl.outputGuide.checks] },
    }));
    setNotice({
      tone: "success",
      message: `Applied template "${tpl.name}". Rules and Output Guide are now active. Save to persist.`,
    });
  }

  async function saveCustomTemplate() {
    if (!templateDraft.name?.trim()) {
      setNotice({ tone: "error", message: "Template name is required." });
      return;
    }
    const templateToSave: WorkflowTemplate = {
      id: templateDraft.id || `tpl-custom-${Date.now()}`,
      name: templateDraft.name.trim(),
      description: templateDraft.description?.trim() || "",
      category: templateDraft.category?.trim() || "Custom",
      formatRules: templateDraft.formatRules || config.formatRules,
      editRules: templateDraft.editRules || config.editRules,
      masterPrompt: templateDraft.masterPrompt || config.masterPrompt,
      outputGuide: normalizeOutputGuide(templateDraft.outputGuide || config.outputGuide),
    };

    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(templateToSave),
      });
      const data = (await res.json()) as { ok?: boolean; template?: WorkflowTemplate; error?: string };
      if (data.ok && data.template) {
        setTemplates((prev) => {
          const filtered = prev.filter((t) => t.id !== data.template!.id);
          return [...filtered, data.template!];
        });
        setActiveTemplateId(data.template.id);
        setIsDraftingTemplate(false);
        setNotice({ tone: "success", message: `Template "${data.template.name}" saved to your workspace library.` });
      } else {
        setNotice({ tone: "error", message: data.error || "Could not save custom template." });
      }
    } catch {
      setNotice({ tone: "error", message: "Network error saving template." });
    }
  }

  async function handleDeleteTemplate(id: string) {
    if (!confirm("Delete this custom template?")) return;
    try {
      const res = await fetch(`/api/templates?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = (await res.json()) as { ok?: boolean };
      if (data.ok) {
        setTemplates((prev) => prev.filter((t) => t.id !== id));
        if (activeTemplateId === id) setActiveTemplateId("tpl-standard-editorial");
        setNotice({ tone: "success", message: "Custom template removed." });
      }
    } catch {
      setNotice({ tone: "error", message: "Could not delete template." });
    }
  }

  function exportTemplate(tpl: WorkflowTemplate) {
    const payload = {
      type: "transcripter-workflow-template",
      version: 1,
      exportedAt: new Date().toISOString(),
      template: tpl,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(tpl.name)}.workflow-template.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportFullWorkflow() {
    const payload = {
      type: "transcripter-workflow",
      version: 2,
      exportedAt: new Date().toISOString(),
      config,
      result,
      crossChecks,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${slugify(config.name)}.workflow.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function importWorkflowOrTemplate(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    file.text().then((raw) => {
      try {
        const payload = JSON.parse(raw);
        if (payload.type === "transcripter-workflow-template" && payload.template) {
          const imported = payload.template as WorkflowTemplate;
          applyTemplate(imported);
          setTemplates((prev) => (prev.some((t) => t.id === imported.id) ? prev : [...prev, imported]));
          setNotice({ tone: "success", message: `Imported template "${imported.name}".` });
        } else if (payload.formatRules || payload.editRules || payload.config) {
          const cfg = normalizeConfig(payload.config || payload);
          setConfig(cfg);
          if (payload.result) setResult(payload.result);
          if (Array.isArray(payload.crossChecks)) setCrossChecks(payload.crossChecks);
          setNotice({ tone: "success", message: "Workflow settings imported. Save to make active." });
        } else {
          setNotice({ tone: "error", message: "Unrecognized template or workflow JSON structure." });
        }
      } catch {
        setNotice({ tone: "error", message: "Could not parse JSON file." });
      }
    });
  }

  const armedAlternatives = useMemo(() => config.fallbackModels.filter(Boolean).length, [config.fallbackModels]);

  if (!ready) {
    return (
      <main className="settings-page">
        <div className="loading-state">
          <span className="spinner dark" />Loading settings
        </div>
      </main>
    );
  }

  const activeTemplate = templates.find((t) => t.id === activeTemplateId) || templates[0];

  return (
    <main className="settings-page">
      <header className="page-header settings-header">
        <div>
          <p className="overline">SETTINGS &amp; GUIDES</p>
          <h1>Shape the edit.</h1>
          <p className="page-subtitle">
            Configure guiding rules, template workflows, and the canvas output guide. Every new source inherits this editorial direction.
          </p>
        </div>
        <div className="header-actions">
          <Link className="text-link" href="/workspace">
            Back to workspace <Icon name="arrow" size={15} />
          </Link>
          <button className="primary-button" onClick={save} disabled={saving}>
            {saving ? (
              <>
                <span className="spinner" />Saving…
              </>
            ) : (
              <>
                <Icon name="check" size={15} />Save changes
              </>
            )}
          </button>
        </div>
      </header>

      {account && account.status !== "approved" && (
        <div className="workspace-notice info">
          <Icon name="lock" size={16} />
          <span>Account status is {account.status.replace("_", " ")}. Guiding rules still apply to demo transcripts.</span>
        </div>
      )}

      {notice && (
        <div className={`workspace-notice ${notice.tone}`}>
          <Icon name={notice.tone === "error" ? "x" : "check"} size={16} />
          <span>{notice.message}</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">
            <Icon name="x" size={15} />
          </button>
        </div>
      )}

      <div className="settings-layout">
        <aside className="settings-index">
          <span className="overline">CONFIGURE</span>
          <a href="#workspace">Workspace</a>
          <a href="#templates">Workflow templates</a>
          <a href="#direction">Editorial direction</a>
          <a href="#output-guide">Output requirements</a>
          {isAdmin && <a href="#models">Models &amp; routing</a>}
          <a href="#limits">Context &amp; limits</a>
          <a href="#handoff">Handoff</a>
        </aside>

        <div className="settings-content">
          {/* Section 01: Workspace */}
          <section className="settings-section" id="workspace">
            <div className="settings-section-heading">
              <span className="settings-number">01</span>
              <div>
                <p className="overline">WORKSPACE</p>
                <h2>Identify this edit</h2>
                <p>Give your workflow a recognizable name and description for your editorial team.</p>
              </div>
            </div>
            <div className="settings-fields two-col">
              <label>
                Workflow name
                <input
                  value={config.name}
                  onChange={(event) => update("name", event.target.value)}
                  placeholder="Transcript edit"
                />
              </label>
              <label>
                Description
                <textarea
                  value={config.description}
                  onChange={(event) => update("description", event.target.value)}
                  placeholder="What type of transcripts is this configured for?"
                />
              </label>
            </div>
          </section>

          {/* Section 02: Workflow Templates & Drafting */}
          <section className="settings-section" id="templates">
            <div className="settings-section-heading">
              <span className="settings-number">02</span>
              <div>
                <p className="overline">WORKFLOW TEMPLATES</p>
                <h2>Template library &amp; drafting</h2>
                <p>
                  Choose a starter workflow or draft a custom template with unique rules and an output guide. Templates are portable, importable, and saved uniquely to your account.
                </p>
              </div>
            </div>

            {/* Template Selector Grid */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "12px", marginBottom: "20px" }}>
              {templates.map((tpl) => {
                const isSelected = activeTemplateId === tpl.id;
                return (
                  <div
                    key={tpl.id}
                    className={`card ${isSelected ? "active-template-card" : ""}`}
                    style={{
                      padding: "16px",
                      cursor: "pointer",
                      border: isSelected ? "2px solid var(--teal)" : "1px solid var(--line)",
                      background: isSelected ? "var(--teal-soft)" : "var(--paper)",
                      display: "flex",
                      flexDirection: "column",
                      justifyContent: "space-between",
                      gap: "10px",
                    }}
                    onClick={() => applyTemplate(tpl)}
                  >
                    <div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", marginBottom: "6px" }}>
                        <span className="badge">{tpl.category || "General"}</span>
                        {tpl.isDefault && <span style={{ fontSize: "9px", color: "var(--muted)" }}>Built-in</span>}
                      </div>
                      <h3 style={{ margin: "4px 0 6px", fontSize: "14px", letterSpacing: "-.02em" }}>{tpl.name}</h3>
                      <p style={{ margin: 0, fontSize: "11px", color: "var(--muted)", lineHeight: "1.5" }}>{tpl.description}</p>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px", paddingTop: "8px", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
                      <span style={{ fontSize: "10px", fontWeight: 700, color: isSelected ? "var(--teal-dark)" : "var(--ink-2)" }}>
                        {isSelected ? "Active template" : "Click to apply"}
                      </span>
                      <div style={{ display: "flex", gap: "4px" }} onClick={(e) => e.stopPropagation()}>
                        <button
                          type="button"
                          className="quiet-button"
                          style={{ minHeight: "26px", padding: "0 6px", fontSize: "10px" }}
                          onClick={() => exportTemplate(tpl)}
                          title="Export template JSON"
                        >
                          <Icon name="download" size={12} />
                        </button>
                        {!tpl.isDefault && (
                          <button
                            type="button"
                            className="quiet-button"
                            style={{ minHeight: "26px", padding: "0 6px", fontSize: "10px", color: "var(--red)" }}
                            onClick={() => void handleDeleteTemplate(tpl.id)}
                            title="Delete custom template"
                          >
                            <Icon name="trash" size={12} />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Template Drafting Toggle / Builder */}
            <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px" }}>
              <button
                type="button"
                className="secondary-button"
                onClick={() => {
                  setTemplateDraft({
                    name: `Custom ${config.name || "Template"}`,
                    description: config.description || "Custom rules and output guide specifications.",
                    category: "Custom",
                    formatRules: config.formatRules,
                    editRules: config.editRules,
                    masterPrompt: config.masterPrompt,
                    outputGuide: { ...config.outputGuide },
                  });
                  setIsDraftingTemplate((prev) => !prev);
                }}
              >
                <Icon name={isDraftingTemplate ? "x" : "plus"} size={14} />
                {isDraftingTemplate ? "Close template drafter" : "Draft new workflow template"}
              </button>

              <label className="quiet-button" style={{ cursor: "pointer" }}>
                <Icon name="upload" size={14} />
                Import template JSON
                <input
                  className="visually-hidden"
                  type="file"
                  accept="application/json,.json"
                  onChange={importWorkflowOrTemplate}
                />
              </label>
            </div>

            {isDraftingTemplate && (
              <div className="card" style={{ padding: "20px", marginBottom: "24px", background: "var(--paper-warm)" }}>
                <div className="card-topline" style={{ marginBottom: "14px" }}>
                  <p className="overline">TEMPLATE DRAFTER</p>
                  <span className="badge">Save to your workspace</span>
                </div>
                <div className="settings-fields two-col" style={{ marginBottom: "16px" }}>
                  <label>
                    Template name
                    <input
                      value={templateDraft.name || ""}
                      onChange={(e) => setTemplateDraft((d) => ({ ...d, name: e.target.value }))}
                      placeholder="e.g. Clinical Dialogue & Patient Consultation"
                    />
                  </label>
                  <label>
                    Category
                    <input
                      value={templateDraft.category || ""}
                      onChange={(e) => setTemplateDraft((d) => ({ ...d, category: e.target.value }))}
                      placeholder="e.g. Medical, Legal, Podcast, Education"
                    />
                  </label>
                </div>
                <label style={{ display: "flex", flexDirection: "column", gap: "6px", marginBottom: "16px" }}>
                  <span style={{ fontWeight: 700, fontSize: "11px" }}>Description</span>
                  <textarea
                    value={templateDraft.description || ""}
                    onChange={(e) => setTemplateDraft((d) => ({ ...d, description: e.target.value }))}
                    placeholder="Brief description of the transformation and audience"
                    style={{ minHeight: "60px" }}
                  />
                </label>

                <div className="settings-fields" style={{ marginBottom: "18px" }}>
                  <label>
                    Format rules
                    <textarea
                      className="large-control"
                      value={templateDraft.formatRules || ""}
                      onChange={(e) => setTemplateDraft((d) => ({ ...d, formatRules: e.target.value }))}
                    />
                  </label>
                  <label>
                    Edit rules
                    <textarea
                      className="large-control"
                      value={templateDraft.editRules || ""}
                      onChange={(e) => setTemplateDraft((d) => ({ ...d, editRules: e.target.value }))}
                    />
                  </label>
                  <label>
                    Master prompt
                    <textarea
                      className="master-control"
                      value={templateDraft.masterPrompt || ""}
                      onChange={(e) => setTemplateDraft((d) => ({ ...d, masterPrompt: e.target.value }))}
                    />
                  </label>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                  <button type="button" className="quiet-button" onClick={() => setIsDraftingTemplate(false)}>
                    Cancel
                  </button>
                  <button type="button" className="primary-button" onClick={() => void saveCustomTemplate()}>
                    <Icon name="check" size={14} />
                    Save template to my library
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Section 03: Editorial Direction */}
          <section className="settings-section" id="direction">
            <div className="settings-section-heading">
              <span className="settings-number">03</span>
              <div>
                <p className="overline">EDITORIAL DIRECTION</p>
                <h2>Protect the meaning</h2>
                <p>These instructions guide every batch. The master prompt sets foundational constraints; rules customize format and voice.</p>
              </div>
            </div>
            <div className="settings-fields">
              <label>
                Format rules
                <span className="field-description">Structure, labels, line breaks, and presentation.</span>
                <textarea
                  className="large-control"
                  value={config.formatRules}
                  onChange={(event) => update("formatRules", event.target.value)}
                />
              </label>
              <label>
                Edit rules
                <span className="field-description">How much to polish, what to preserve, and what not to invent.</span>
                <textarea
                  className="large-control"
                  value={config.editRules}
                  onChange={(event) => update("editRules", event.target.value)}
                />
              </label>
              <label>
                Master prompt
                <span className="field-description">The non-negotiable instruction prepended to Normalize, Format, and Edit passes.</span>
                <textarea
                  className="master-control"
                  value={config.masterPrompt}
                  onChange={(event) => update("masterPrompt", event.target.value)}
                />
              </label>
            </div>
          </section>

          {/* Section 04: Output Requirements Guide */}
          <section className="settings-section" id="output-guide">
            <div className="settings-section-heading">
              <span className="settings-number">04</span>
              <div>
                <p className="overline">OUTPUT REQUIREMENTS GUIDE</p>
                <h2>Canvas display specification</h2>
                <p>
                  This output guide dictates how the final transcript is rendered and audited on the Canvas. It defines speaker tags, paragraph rhythm, punctuation conventions, and quality criteria.
                </p>
              </div>
            </div>

            <div className="settings-fields">
              <label>
                Output guide title
                <input
                  value={config.outputGuide.title}
                  onChange={(e) => updateOutputGuide("title", e.target.value)}
                  placeholder="e.g. Standard Publication Layout & Speaker Format"
                />
              </label>

              <div className="settings-fields two-col">
                <label>
                  Speaker formatting convention
                  <span className="field-description">How speaker turns should appear in the final output.</span>
                  <textarea
                    value={config.outputGuide.speakerFormat}
                    onChange={(e) => updateOutputGuide("speakerFormat", e.target.value)}
                    placeholder="UPPERCASE label followed by colon (e.g., SPEAKER 1:) on a new line."
                  />
                </label>
                <label>
                  Paragraph break rules
                  <span className="field-description">Paragraph bounds and reading rhythm.</span>
                  <textarea
                    value={config.outputGuide.paragraphRules}
                    onChange={(e) => updateOutputGuide("paragraphRules", e.target.value)}
                    placeholder="Natural breaks at conversational pauses under 120 words. Double line breaks between turns."
                  />
                </label>
              </div>

              <div className="settings-fields two-col">
                <label>
                  Punctuation conventions
                  <span className="field-description">Rules for punctuation marks, false starts, and speech pauses.</span>
                  <textarea
                    value={config.outputGuide.punctuationRules}
                    onChange={(e) => updateOutputGuide("punctuationRules", e.target.value)}
                    placeholder="Terminal punctuation (. ! ?) on all sentences. Em-dash (—) for interruptions."
                  />
                </label>
                <label>
                  Uncertainty markers
                  <span className="field-description">Conventions for inaudible tags or audio crosstalk.</span>
                  <textarea
                    value={config.outputGuide.uncertaintyMarkers}
                    onChange={(e) => updateOutputGuide("uncertaintyMarkers", e.target.value)}
                    placeholder="Preserve bracketed tags: [inaudible], [crosstalk]. Flag for editorial review."
                  />
                </label>
              </div>

              <div className="card" style={{ padding: "16px", marginTop: "10px", background: "var(--paper-warm)" }}>
                <p className="overline" style={{ marginBottom: "10px" }}>CANVAS QUALITY VERIFICATION CHECKS</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {config.outputGuide.checks.map((chk, idx) => (
                    <div
                      key={chk.id || idx}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "8px 12px",
                        background: "var(--paper)",
                        borderRadius: "6px",
                        border: "1px solid var(--line-soft)",
                      }}
                    >
                      <div>
                        <strong style={{ fontSize: "11px", color: "var(--ink-2)" }}>{chk.label}</strong>
                        <p style={{ margin: "2px 0 0", fontSize: "10px", color: "var(--muted)" }}>{chk.description}</p>
                      </div>
                      <span className="badge">{chk.category}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* Section 05: Models & Routing — Admin Only */}
          {isAdmin && (
            <section className="settings-section" id="models">
              <div className="settings-section-heading">
                <span className="settings-number">05</span>
                <div>
                  <p className="overline">MODELS &amp; ROUTING · ADMIN ONLY</p>
                  <h2>Configure models for everyone</h2>
                  <p>
                    Only administrators can see or adjust language models. Clicking <strong>Save models for everyone</strong> applies these choices across all users on this platform.
                  </p>
                </div>
              </div>

              <datalist id="settings-models">
                {MODEL_OPTIONS.map((model) => (
                  <option key={model} value={model} />
                ))}
              </datalist>

              <div className="settings-fields two-col">
                <label>
                  Primary model
                  <input
                    className="mono-control"
                    list="settings-models"
                    value={config.primaryModel}
                    onChange={(event) => update("primaryModel", event.target.value)}
                  />
                  <span className="field-description">First choice for every editorial pass for all users.</span>
                </label>

                <div className="alternative-list">
                  <div className="alternative-title">
                    <span>Alternative fallback models</span>
                    <strong>{armedAlternatives}/{MAX_ALTERNATIVES} active</strong>
                  </div>
                  {config.fallbackModels.map((model, index) => (
                    <div className="alternative-row" key={`alternative-${index}`}>
                      <span>{String(index + 1).padStart(2, "0")}</span>
                      <input
                        className="mono-control"
                        list="settings-models"
                        value={model}
                        onChange={(event) => updateFallback(index, event.target.value)}
                        placeholder="model/provider-id"
                        aria-label={`Alternative model ${index + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeFallback(index)}
                        aria-label={`Remove alternative model ${index + 1}`}
                      >
                        <Icon name="x" size={14} />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="add-alternative"
                    onClick={addFallback}
                    disabled={config.fallbackModels.length >= MAX_ALTERNATIVES}
                  >
                    <Icon name="plus" size={14} />Add alternative model
                  </button>
                </div>
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "18px" }}>
                <button
                  type="button"
                  className="primary-button"
                  onClick={() => void saveAdminModels()}
                  disabled={savingModels || !config.primaryModel.trim()}
                >
                  {savingModels ? (
                    <>
                      <span className="spinner" />Saving models for everyone…
                    </>
                  ) : (
                    <>
                      <Icon name="check" size={15} />Save models for everyone
                    </>
                  )}
                </button>
              </div>
            </section>
          )}

          {/* Section 06 / Limits: Context & Limits */}
          <section className="settings-section" id="limits">
            <div className="settings-section-heading">
              <span className="settings-number">{isAdmin ? "06" : "05"}</span>
              <div>
                <p className="overline">CONTEXT &amp; LIMITS</p>
                <h2>Keep every call inside the window</h2>
                <p>The planner estimates four characters per token and preserves continuity context between batches.</p>
              </div>
            </div>
            <div className="settings-fields limits-grid">
              <label>
                Context window
                <select
                  value={config.contextWindow}
                  onChange={(event) => update("contextWindow", Number(event.target.value))}
                >
                  <option value={8192}>8,192 tokens</option>
                  <option value={16384}>16,384 tokens</option>
                  <option value={32768}>32,768 tokens</option>
                  <option value={65536}>65,536 tokens</option>
                  <option value={131072}>131,072 tokens</option>
                </select>
              </label>
              <label>
                Batch target
                <input
                  type="number"
                  min={400}
                  max={20000}
                  value={config.batchTokens}
                  onChange={(event) =>
                    update("batchTokens", Math.min(20000, Math.max(400, Number(event.target.value) || 400)))
                  }
                />
                <span className="field-description">Smaller batches preserve more local conversational context.</span>
              </label>
              <label>
                Continuity overlap
                <input
                  type="number"
                  min={0}
                  max={1000}
                  value={config.overlapTokens}
                  onChange={(event) =>
                    update("overlapTokens", Math.min(1000, Math.max(0, Number(event.target.value) || 0)))
                  }
                />
                <span className="field-description">Reference only; never duplicated in output.</span>
              </label>
              <label>
                Max output tokens
                <input
                  type="number"
                  min={256}
                  max={16000}
                  value={config.maxOutputTokens}
                  onChange={(event) =>
                    update("maxOutputTokens", Math.min(16000, Math.max(256, Number(event.target.value) || 256)))
                  }
                />
              </label>
              <label className="temperature-setting">
                Temperature
                <div className="temperature-control">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.05"
                    value={config.temperature}
                    onChange={(event) => update("temperature", Number(event.target.value))}
                  />
                  <output>{config.temperature.toFixed(2)}</output>
                </div>
              </label>
            </div>
          </section>

          {/* Section 07 / Handoff */}
          <section className="settings-section" id="handoff">
            <div className="settings-section-heading">
              <span className="settings-number">{isAdmin ? "07" : "06"}</span>
              <div>
                <p className="overline">HANDOFF</p>
                <h2>Take the workflow with you</h2>
                <p>Export your full workflow or import one from a colleague.</p>
              </div>
            </div>
            <div className="handoff-actions">
              <button className="secondary-button" onClick={exportFullWorkflow}>
                <Icon name="download" size={15} />Export workflow
              </button>
              <label className="secondary-button">
                <Icon name="upload" size={15} />Import workflow or template
                <input
                  className="visually-hidden"
                  type="file"
                  accept="application/json,.json"
                  onChange={importWorkflowOrTemplate}
                />
              </label>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
