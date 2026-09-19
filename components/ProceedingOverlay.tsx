"use client";

import { useEffect, useRef, useState } from "react";
import Icon from "./Icon";
import { MODEL_OPTIONS, shortModel } from "../lib/workflow";

export type OverlayStep = {
  key: string;
  label: string;
  description: string;
  status: "done" | "active" | "waiting" | "error";
};

export type OverlayLog = {
  id: string;
  text: string;
  tone: "success" | "running" | "error" | "info";
  meta?: string;
};

export default function ProceedingOverlay({
  open,
  title,
  subtitle,
  percent,
  summaryLeft,
  summaryRight,
  steps = [],
  log = [],
  error,
  busy,
  activeModel = "nvidia/nemotron-3.5-lightning:free",
  onModelChange,
  singleModelOnly = false,
  onToggleSingleModel,
  onRetry,
  onContinue,
  onPause,
  onClose,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  percent: number;
  summaryLeft?: string;
  summaryRight?: string;
  steps?: OverlayStep[];
  log?: OverlayLog[];
  error?: { message: string; retryable?: boolean } | null;
  busy?: boolean;
  activeModel?: string;
  onModelChange?: (model: string) => void;
  singleModelOnly?: boolean;
  onToggleSingleModel?: (enabled: boolean) => void;
  onRetry?: () => void;
  onContinue?: () => void;
  onPause?: () => void;
  onClose?: () => void;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [minimized, setMinimized] = useState(false);
  const [customModelInput, setCustomModelInput] = useState(activeModel);

  // Sync customModelInput when activeModel changes
  useEffect(() => {
    setCustomModelInput(activeModel);
  }, [activeModel]);

  // If error occurs while minimized, auto-expand so user can see it
  useEffect(() => {
    if (error && minimized) {
      setMinimized(false);
    }
  }, [error, minimized]);

  // Reset minimized on fresh open
  useEffect(() => {
    if (open && !busy && !error) {
      setMinimized(false);
    }
  }, [open]);

  useEffect(() => {
    if (!open || minimized) return;
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [open, log.length, minimized]);

  if (!open) return null;

  // Minimized floating pill bar (non-blocking)
  if (minimized) {
    return (
      <div className="proceeding-root minimized" role="region" aria-label="Progress tracker">
        <div className="proceeding-minibar">
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
              {busy ? (
                <span className="spinner" style={{ width: "14px", height: "14px" }} />
              ) : (
                <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: error ? "var(--red)" : "var(--accent)" }} />
              )}
              <div style={{ minWidth: 0 }}>
                <strong style={{ fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block" }}>
                  {summaryRight || title}
                </strong>
                <span style={{ fontSize: "10px", color: "var(--muted)" }}>
                  {summaryLeft ? `${summaryLeft} · ` : ""}{Math.max(0, Math.min(100, percent))}%
                </span>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "4px", flexShrink: 0 }}>
              {busy && onPause && (
                <button
                  type="button"
                  className="quiet-button"
                  onClick={onPause}
                  title="Pause pass"
                  style={{ padding: "4px 6px", fontSize: "11px", height: "26px" }}
                >
                  <Icon name="pause" size={13} />
                </button>
              )}
              <button
                type="button"
                className="quiet-button"
                onClick={() => setMinimized(false)}
                title="Expand tracker"
                style={{ padding: "4px 8px", fontSize: "11px", height: "26px", fontWeight: 600 }}
              >
                <Icon name="maximize" size={13} />
                <span>Expand</span>
              </button>
            </div>
          </div>

          <div className="progress-track" style={{ height: "4px", margin: "2px 0 0" }}>
            <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: "10px", color: "var(--muted)" }}>
            <span title={activeModel}>
              Model: <strong style={{ color: "var(--ink)" }}>{shortModel(activeModel)}</strong>
            </span>
            {onModelChange && (
              <select
                value={activeModel}
                onChange={(e) => onModelChange(e.target.value)}
                style={{
                  fontSize: "10px",
                  padding: "1px 4px",
                  border: "1px solid var(--line)",
                  borderRadius: "4px",
                  background: "var(--surface)",
                  color: "var(--ink)",
                  maxWidth: "140px",
                }}
                aria-label="Switch model in minibar"
              >
                <option value="nvidia/nemotron-3.5-lightning:free">⚡ Nemotron 3.5 Lightning (Free)</option>
                <option value="nvidia/nemotron-3.5-lightning">⚡ Nemotron 3.5 Lightning</option>
                <option value="nvidia/nemotron-3-ultra-550b-a55b">Nemotron 3 Ultra</option>
                <option value="google/gemma-4-26b-a4b-it:free">OpenRouter Gemma:free</option>
                <option value="gemini-2.0-flash">Gemini 2.0 Flash</option>
              </select>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Full Overlay Modal Dialog
  return (
    <div className="proceeding-root" role="dialog" aria-modal="true" aria-labelledby="proceeding-title">
      <div className="proceeding-card">
        {/* Header with Title, Progress, and Minimize button */}
        <div className="proceeding-heading">
          <div>
            <p className="overline">{busy ? "IN PROGRESS" : error ? "NEEDS ATTENTION" : "PROCEEDING"}</p>
            <h2 id="proceeding-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div className="run-percent" aria-live="polite">
              <strong>{Math.max(0, Math.min(100, percent))}</strong>
              <span>%</span>
            </div>
            {/* Minimize button */}
            <button
              type="button"
              className="quiet-button"
              onClick={() => setMinimized(true)}
              title="Minimize status popup to background"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "5px",
                padding: "6px 10px",
                fontSize: "12px",
                borderRadius: "6px",
                border: "1px solid var(--line)",
                background: "var(--surface)",
                cursor: "pointer",
              }}
            >
              <Icon name="minimize" size={14} />
              <span>Minimize</span>
            </button>
          </div>
        </div>

        {/* Progress bar */}
        <div className="progress-track" style={{ marginTop: "12px" }}>
          <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </div>
        <div className="run-summary">
          <span>{summaryLeft}</span>
          <span>{summaryRight}</span>
        </div>

        {/* MODEL SWITCHER & RETRY CONFIGURATION */}
        {onModelChange && (
          <div className="proceeding-model-box">
            <div className="proceeding-model-top">
              <label htmlFor="overlay-model-input">Active AI Model</label>
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                {onToggleSingleModel && (
                  <label style={{ fontSize: "11px", display: "flex", alignItems: "center", gap: "4px", cursor: "pointer", color: "var(--muted)", fontWeight: 500, textTransform: "none" }}>
                    <input
                      type="checkbox"
                      checked={Boolean(singleModelOnly)}
                      onChange={(e) => onToggleSingleModel(e.target.checked)}
                      style={{ margin: 0 }}
                    />
                    <span>Lock retries to this model only</span>
                  </label>
                )}
                <span className="badge" style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "4px", background: "var(--paper)", border: "1px solid var(--line)" }}>
                  {shortModel(activeModel)}
                </span>
              </div>
            </div>

            <datalist id="popup-models-list">
              {MODEL_OPTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>

            <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
              <input
                id="overlay-model-input"
                list="popup-models-list"
                value={customModelInput}
                onChange={(e) => {
                  setCustomModelInput(e.target.value);
                  onModelChange(e.target.value);
                }}
                placeholder="Switch model or enter custom..."
                style={{
                  flex: 1,
                  padding: "6px 10px",
                  fontSize: "12px",
                  fontFamily: "var(--mono, monospace)",
                  border: "1px solid var(--line)",
                  borderRadius: "6px",
                  background: "var(--paper)",
                  color: "var(--ink)",
                }}
              />
            </div>

            {/* Quick preset switch buttons */}
            <div className="proceeding-presets">
              <button
                type="button"
                className={activeModel === "nvidia/nemotron-3.5-lightning:free" ? "active" : ""}
                onClick={() => {
                  setCustomModelInput("nvidia/nemotron-3.5-lightning:free");
                  onModelChange("nvidia/nemotron-3.5-lightning:free");
                }}
              >
                ⚡ Nemotron 3.5 Lightning (Free)
              </button>
              <button
                type="button"
                className={activeModel === "nvidia/nemotron-3.5-lightning" ? "active" : ""}
                onClick={() => {
                  setCustomModelInput("nvidia/nemotron-3.5-lightning");
                  onModelChange("nvidia/nemotron-3.5-lightning");
                }}
              >
                ⚡ Nemotron 3.5 Lightning
              </button>
              <button
                type="button"
                className={activeModel === "nvidia/nemotron-3-ultra-550b-a55b" ? "active" : ""}
                onClick={() => {
                  setCustomModelInput("nvidia/nemotron-3-ultra-550b-a55b");
                  onModelChange("nvidia/nemotron-3-ultra-550b-a55b");
                }}
              >
                Nemotron 3 Ultra
              </button>
              <button
                type="button"
                className={activeModel === "google/gemma-4-26b-a4b-it:free" ? "active" : ""}
                onClick={() => {
                  setCustomModelInput("google/gemma-4-26b-a4b-it:free");
                  onModelChange("google/gemma-4-26b-a4b-it:free");
                }}
              >
                Gemma 4:free
              </button>
              <button
                type="button"
                className={activeModel === "gemini-2.0-flash" ? "active" : ""}
                onClick={() => {
                  setCustomModelInput("gemini-2.0-flash");
                  onModelChange("gemini-2.0-flash");
                }}
              >
                Gemini 2.0 Flash
              </button>
            </div>
          </div>
        )}

        {/* Steps breakdown */}
        {steps.length > 0 && (
          <div className="process-list" style={{ marginTop: "14px" }}>
            {steps.map((step, index) => (
              <div className={`process-row ${step.status}`} key={step.key}>
                <span className="process-number">
                  {step.status === "done" ? <Icon name="check" size={14} /> : String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.description}</span>
                </div>
                <em>{step.status === "done" ? "Complete" : step.status === "active" ? "Working" : step.status === "error" ? "Stopped" : "Queued"}</em>
              </div>
            ))}
          </div>
        )}

        {/* Live event log */}
        <div className="proceeding-log" aria-live="polite">
          <div className="trace-mini-head">
            <span>LIVE UPDATES</span>
            <span>{log.length} events</span>
          </div>
          <div className="proceeding-log-body">
            {log.map((entry) => (
              <div className={`trace-mini-row ${entry.tone}`} key={entry.id}>
                <span className="trace-mini-dot" />
                <span>{entry.text}</span>
                {entry.meta && <small>{entry.meta}</small>}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Error notification if pass stopped */}
        {error && (
          <div className="proceeding-error">
            <Icon name="alert" size={16} />
            <div style={{ flex: 1 }}>
              <strong>This pass stopped</strong>
              <p>{error.message}</p>
              <p style={{ marginTop: "4px", fontSize: "11px", color: "var(--ink-2)" }}>
                You can switch models above or retry directly.
              </p>
            </div>
          </div>
        )}

        {/* Actions buttons */}
        <div className="proceeding-actions">
          {error && onRetry && (
            <button type="button" className="primary-button" onClick={onRetry} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
              Retry pass ({shortModel(activeModel)})
            </button>
          )}

          {/* Quick 1-click button to switch to Lightning model and retry if another model failed */}
          {error && onRetry && onModelChange && activeModel !== "nvidia/nemotron-3.5-lightning:free" && (
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                onModelChange("nvidia/nemotron-3.5-lightning:free");
                setTimeout(() => onRetry(), 50);
              }}
              disabled={busy}
              style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}
            >
              <Icon name="spark" size={14} />
              Retry with Nemotron Lightning (Free)
            </button>
          )}

          {error && onContinue && (
            <button type="button" className="secondary-button" onClick={onContinue} disabled={busy}>
              Continue later
            </button>
          )}

          {busy && onPause && (
            <button type="button" className="quiet-button" onClick={onPause}>
              <Icon name="pause" size={15} />
              Pause
            </button>
          )}

          {busy && (
            <button type="button" className="quiet-button" onClick={() => setMinimized(true)}>
              <Icon name="minimize" size={14} />
              Run in background
            </button>
          )}

          {!busy && onClose && (
            <button type="button" className="quiet-button" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
