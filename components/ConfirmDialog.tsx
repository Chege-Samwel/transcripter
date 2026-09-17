"use client";

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="proceeding-root" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="proceeding-card confirm-card">
        <p className="overline">PLEASE CONFIRM</p>
        <h2 id="confirm-title">{title}</h2>
        <p>{body}</p>
        <div className="proceeding-actions">
          <button type="button" className="quiet-button" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="primary-button danger-button" onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spinner" /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
