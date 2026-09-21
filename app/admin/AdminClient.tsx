'use client';

import { useEffect, useState } from "react";
import Icon from "../../components/Icon";
import ProceedingOverlay from "../../components/ProceedingOverlay";
import { requestJson } from "../../lib/http";
import type { Account, UserStatus } from "../../lib/types";
import { MAX_ALTERNATIVES, MODEL_OPTIONS } from "../../lib/workflow";

type ListedUser = Account & { createdAt?: string; approvedAt?: string | null; approvedBy?: string | null };

export default function AdminClient({ account }: { account: Account }) {
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [overlay, setOverlay] = useState<{ open: boolean; title: string; detail: string; busy: boolean; error?: string }>({
    open: false,
    title: "",
    detail: "",
    busy: false,
  });

  // Admin-only System Models state
  const [primaryModel, setPrimaryModel] = useState<string>("nvidia/llama-3.1-nemotron-ultra-253b-v1");
  const [fallbackModels, setFallbackModels] = useState<string[]>([
    "nvidia/llama-3.1-nemotron-nano-vl-8b-v1",
    "meta/llama-3.1-70b-instruct",
  ]);
  const [modelOptions, setModelOptions] = useState<string[]>(MODEL_OPTIONS);
  const [savingModels, setSavingModels] = useState(false);
  const [modelsNotice, setModelsNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const [usersRes, modelsRes] = await Promise.all([
        requestJson<{ users?: ListedUser[]; message?: string; error?: string }>("/api/admin/users"),
        requestJson<{
          models?: { primaryModel?: string; fallbackModels?: string[] };
          modelOptions?: string[];
        }>("/api/admin/models"),
      ]);

      if (cancelled) return;
      setUsers(Array.isArray(usersRes.data.users) ? usersRes.data.users : []);
      if (usersRes.data.message) setMessage(usersRes.data.message);

      if (modelsRes.data.models) {
        if (modelsRes.data.models.primaryModel) setPrimaryModel(modelsRes.data.models.primaryModel);
        if (Array.isArray(modelsRes.data.models.fallbackModels)) {
          setFallbackModels(modelsRes.data.models.fallbackModels);
        }
      }
      if (Array.isArray(modelsRes.data.modelOptions) && modelsRes.data.modelOptions.length) {
        setModelOptions(modelsRes.data.modelOptions);
      }
      setReady(true);
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!modelsNotice) return;
    const timer = window.setTimeout(() => setModelsNotice(null), 5000);
    return () => window.clearTimeout(timer);
  }, [modelsNotice]);

  async function setStatus(email: string, status: UserStatus) {
    setOverlay({ open: true, title: "Updating account status", detail: `${email} → ${status}`, busy: true });
    const { ok, data } = await requestJson<{ users?: ListedUser[]; error?: string }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify({ email, status }),
    });
    if (!ok) {
      setOverlay({ open: true, title: "Status was not updated", detail: data.error || "The change did not save.", busy: false, error: data.error || "The change did not save." });
      return;
    }
    setUsers(Array.isArray(data.users) ? data.users : []);
    setOverlay({ open: false, title: "", detail: "", busy: false });
    setMessage(`${email} is now ${status.replace("_", " ")}.`);
  }

  const updateFallback = (index: number, value: string) => {
    setFallbackModels((current) => {
      const next = [...current];
      while (next.length <= index) next.push("");
      next[index] = value;
      return next;
    });
  };

  const addFallback = () => {
    if (fallbackModels.length < MAX_ALTERNATIVES) {
      setFallbackModels((current) => [...current, ""]);
    }
  };

  const removeFallback = (index: number) => {
    setFallbackModels((current) => current.filter((_, i) => i !== index));
  };

  async function saveSystemModels() {
    setSavingModels(true);
    setModelsNotice(null);
    try {
      const { ok, data } = await requestJson<{ ok?: boolean; message?: string; error?: string }>(
        "/api/admin/models",
        {
          method: "POST",
          body: JSON.stringify({
            primaryModel: primaryModel.trim(),
            fallbackModels: fallbackModels.filter(Boolean),
          }),
        }
      );
      if (ok) {
        setModelsNotice({
          tone: "success",
          text: data.message || "Models updated successfully. These models are now active for everyone across the platform.",
        });
      } else {
        setModelsNotice({
          tone: "error",
          text: data.error || "Could not update system models.",
        });
      }
    } catch {
      setModelsNotice({
        tone: "error",
        text: "Could not reach the server to update models.",
      });
    } finally {
      setSavingModels(false);
    }
  }

  if (!ready) return <main className="workspace-page"><div className="loading-state"><span className="spinner dark" />Loading administration</div></main>;

  const awaiting = users.filter((user) => user.status === "awaiting_approval").length;
  const armedAlternatives = fallbackModels.filter(Boolean).length;

  return (
    <main className="workspace-page">
      <header className="page-header">
        <div>
          <p className="overline">ADMINISTRATION</p>
          <h1>Platform control.</h1>
          <p className="page-subtitle">Manage user approvals and platform-wide language models. Only administrators can view and configure models.</p>
        </div>
      </header>
      {message && <div className="workspace-notice info"><Icon name="spark" size={16} /><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss"><Icon name="x" size={15} /></button></div>}

      {/* Admin Models & Routing Configuration */}
      <section className="card" style={{ padding: "26px", marginBottom: "32px" }}>
        <div className="card-topline" style={{ marginBottom: "14px" }}>
          <div>
            <p className="overline">SYSTEM MODELS &amp; ROUTING · ADMIN ONLY</p>
            <h2 style={{ margin: "6px 0 4px", fontSize: "19px", letterSpacing: "-.03em" }}>Language models used by everyone</h2>
          </div>
          <span className="badge approved">Admin only</span>
        </div>
        <p style={{ color: "var(--muted)", fontSize: "11px", lineHeight: "1.6", maxWidth: "680px", margin: "0 0 20px" }}>
          Adjust the primary editorial model and fallback alternatives below. Regular users cannot see or modify these models. Clicking <strong>Save models</strong> updates the models used by every editor across the entire workspace.
        </p>

        {modelsNotice && (
          <div className={`workspace-notice ${modelsNotice.tone}`} style={{ margin: "0 0 18px" }}>
            <Icon name={modelsNotice.tone === "error" ? "x" : "check"} size={16} />
            <span>{modelsNotice.text}</span>
            <button onClick={() => setModelsNotice(null)} aria-label="Dismiss"><Icon name="x" size={15} /></button>
          </div>
        )}

        <datalist id="admin-model-options">
          {modelOptions.map((model) => (
            <option key={model} value={model} />
          ))}
        </datalist>

        <div className="settings-fields two-col" style={{ marginBottom: "20px" }}>
          <label>
            Primary model
            <input
              className="mono-control"
              list="admin-model-options"
              value={primaryModel}
              onChange={(e) => setPrimaryModel(e.target.value)}
              placeholder="e.g. nvidia/llama-3.1-nemotron-ultra-253b-v1"
            />
            <span className="field-description">First-choice engine for normalize, format, edit, and refine passes for all users.</span>
          </label>

          <div className="alternative-list">
            <div className="alternative-title">
              <span>Alternative fallback models</span>
              <strong>{armedAlternatives}/{MAX_ALTERNATIVES} active</strong>
            </div>
            {fallbackModels.map((model, index) => (
              <div className="alternative-row" key={`alt-${index}`}>
                <span>{String(index + 1).padStart(2, "0")}</span>
                <input
                  className="mono-control"
                  list="admin-model-options"
                  value={model}
                  onChange={(e) => updateFallback(index, e.target.value)}
                  placeholder="fallback/model-id"
                  aria-label={`Fallback model ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => removeFallback(index)}
                  aria-label={`Remove fallback model ${index + 1}`}
                >
                  <Icon name="x" size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="add-alternative"
              onClick={addFallback}
              disabled={fallbackModels.length >= MAX_ALTERNATIVES}
            >
              <Icon name="plus" size={14} />
              Add fallback model
            </button>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: "12px", borderTop: "1px solid var(--line-soft)", paddingTop: "16px" }}>
          <button
            type="button"
            className="primary-button"
            onClick={() => void saveSystemModels()}
            disabled={savingModels || !primaryModel.trim()}
          >
            {savingModels ? (
              <>
                <span className="spinner" />
                Saving models for everyone…
              </>
            ) : (
              <>
                <Icon name="check" size={15} />
                Save models for everyone
              </>
            )}
          </button>
        </div>
      </section>

      {/* User Approvals Section */}
      <div style={{ marginBottom: "16px" }}>
        <p className="overline">USER APPROVALS</p>
        <h2 style={{ margin: "4px 0 0", fontSize: "19px", letterSpacing: "-.03em" }}>Account registrations</h2>
      </div>

      <section className="admin-summary">
        <div className="card"><strong>{awaiting}</strong><span>Awaiting approval</span></div>
        <div className="card"><strong>{users.filter((user) => user.status === "approved").length}</strong><span>Approved</span></div>
        <div className="card"><strong>{users.filter((user) => user.status === "suspended").length}</strong><span>Suspended</span></div>
      </section>

      <section className="history-list">
        {users.length === 0 ? (
          <div className="empty-history card">
            <p className="overline">NO REGISTRATIONS</p>
            <h2>Waiting on the first signup.</h2>
            <p>When someone creates an account it lands here with status awaiting_approval.</p>
          </div>
        ) : users.map((user) => (
          <article className="history-row card" key={user.email}>
            <div>
              <div className="history-title-row">
                <h2>{user.displayName || user.email}</h2>
                <span className={`badge ${user.status}`}>{user.status.replace("_", " ")}</span>
                <span className="badge">{user.role}</span>
              </div>
              <p>{user.email}{user.approvedBy ? ` · approved by ${user.approvedBy}` : ""}</p>
            </div>
            <div className="history-actions">
              {user.status !== "approved" && <button type="button" className="primary-button" onClick={() => void setStatus(user.email, "approved")}>Approve</button>}
              {user.status !== "awaiting_approval" && user.email !== account.email && <button type="button" className="quiet-button" onClick={() => void setStatus(user.email, "awaiting_approval")}>Return to awaiting</button>}
              {user.status !== "suspended" && user.email !== account.email && <button type="button" className="quiet-button" onClick={() => void setStatus(user.email, "suspended")}>Suspend</button>}
            </div>
          </article>
        ))}
      </section>

      <ProceedingOverlay
        open={overlay.open}
        title={overlay.title}
        subtitle={overlay.detail}
        percent={overlay.busy ? 55 : overlay.error ? 100 : 100}
        busy={overlay.busy}
        error={overlay.error ? { message: overlay.error, retryable: true } : null}
        log={[{ id: "status", text: overlay.detail || "Updating status", tone: overlay.error ? "error" : overlay.busy ? "running" : "success" }]}
        onClose={() => setOverlay({ open: false, title: "", detail: "", busy: false })}
      />
    </main>
  );
}
