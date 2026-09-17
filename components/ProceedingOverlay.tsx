"use client";

import { useEffect, useRef } from "react";
import Icon from "./Icon";

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
  onRetry?: () => void;
  onContinue?: () => void;
  onPause?: () => void;
  onClose?: () => void;
}) {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    logEndRef.current?.scrollIntoView({ block: "end" });
  }, [open, log.length]);

  if (!open) return null;

  return (
    <div className="proceeding-root" role="dialog" aria-modal="true" aria-labelledby="proceeding-title">
      <div className="proceeding-card">
        <div className="proceeding-heading">
          <div>
            <p className="overline">{busy ? "IN PROGRESS" : error ? "NEEDS ATTENTION" : "PROCEEDING"}</p>
            <h2 id="proceeding-title">{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <div className="run-percent" aria-live="polite">
            <strong>{Math.max(0, Math.min(100, percent))}</strong>
            <span>%</span>
          </div>
        </div>
        <div className="progress-track">
          <span style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
        </div>
        <div className="run-summary">
          <span>{summaryLeft}</span>
          <span>{summaryRight}</span>
        </div>
        {steps.length > 0 && (
          <div className="process-list">
            {steps.map((step, index) => (
              <div className={`process-row ${step.status}`} key={step.key}>
                <span className="process-number">{step.status === "done" ? <Icon name="check" size={14} /> : String(index + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.description}</span>
                </div>
                <em>{step.status === "done" ? "Complete" : step.status === "active" ? "Working" : step.status === "error" ? "Stopped" : "Queued"}</em>
              </div>
            ))}
          </div>
        )}
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
        {error && (
          <div className="proceeding-error">
            <Icon name="alert" size={16} />
            <div>
              <strong>This pass stopped</strong>
              <p>{error.message}</p>
            </div>
          </div>
        )}
        <div className="proceeding-actions">
          {error && onRetry && (
            <button type="button" className="primary-button" onClick={onRetry} disabled={busy}>
              {busy ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
              Retry this pass
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
              Continue later
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
