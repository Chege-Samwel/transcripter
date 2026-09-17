"use client";

import { useMemo, useState } from "react";
import CopyButton from "./CopyButton";
import Icon from "./Icon";
import type { JobRecord } from "../lib/types";
import { formatNumber } from "../lib/workflow";

type CanvasKey = "all" | "source" | "normalize" | "format" | "edit" | "refine" | "batches";

export default function EditsCanvas({
  job,
  onChangePart,
}: {
  job: JobRecord;
  onChangePart: (part: "source" | "normalize" | "format" | "edit" | "refine", value: string) => void;
}) {
  const parts = useMemo(
    () =>
      [
        { key: "source" as const, label: "Source", text: job.source, hint: "Original wording" },
        { key: "normalize" as const, label: "Normalized", text: job.stages.normalize, hint: "Clean signals" },
        { key: "format" as const, label: "Formatted", text: job.stages.format, hint: "Structure applied" },
        { key: "edit" as const, label: "Edited", text: job.stages.edit || job.result, hint: "Publishable pass" },
        { key: "refine" as const, label: "Refined", text: job.stages.refine, hint: "Requested changes" },
      ].filter((part) => part.key === "source" || part.key === "edit" || part.text),
    [job],
  );
  const [tab, setTab] = useState<CanvasKey>("all");
  const visible = tab === "all" || tab === "batches" ? parts : parts.filter((part) => part.key === tab);

  return (
    <div className="canvas-shell">
      <div className="canvas-tabs" role="tablist" aria-label="Edit stages">
        <button type="button" className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
          All parts
        </button>
        {parts.map((part) => (
          <button type="button" className={tab === part.key ? "active" : ""} key={part.key} onClick={() => setTab(part.key)}>
            {part.label}
          </button>
        ))}
        {job.batches.length > 0 && (
          <button type="button" className={tab === "batches" ? "active" : ""} onClick={() => setTab("batches")}>
            Batches
          </button>
        )}
      </div>

      {tab !== "batches" && (
        <div className={`canvas-grid ${tab === "all" ? "stacked" : "single"}`}>
          {visible.map((part) => (
            <article className="card canvas-card" key={part.key}>
              <div className="output-topline">
                <span>
                  <i />
                  {part.label.toUpperCase()}
                  <em>{part.hint}</em>
                </span>
                <span className="canvas-card-actions">
                  <span>{formatNumber(part.text.length)} chars</span>
                  <CopyButton text={part.text} label={`Copy ${part.label.toLowerCase()}`} />
                </span>
              </div>
              <textarea
                value={part.text}
                onChange={(event) => onChangePart(part.key, event.target.value)}
                spellCheck={false}
                aria-label={part.label}
                placeholder={`${part.label} will appear here after this pass finishes. You can paste a correction at any time.`}
              />
            </article>
          ))}
        </div>
      )}

      {tab === "batches" && (
        <div className="batch-list">
          {job.batches.map((batch) => (
            <article className="card canvas-card" key={`batch-${batch.index}`}>
              <div className="output-topline">
                <span>
                  <i />
                  BATCH {String(batch.index + 1).padStart(2, "0")}
                </span>
                <CopyButton text={batch.edit || batch.format || batch.normalize || batch.source} label="Copy batch" />
              </div>
              <div className="batch-parts">
                {[
                  ["Source", batch.source],
                  ["Normalized", batch.normalize],
                  ["Formatted", batch.format],
                  ["Edited", batch.edit],
                ].map(([label, text]) => (
                  <div key={label}>
                    <div className="batch-part-head">
                      <strong>{label}</strong>
                      <CopyButton text={text} label="Copy" />
                    </div>
                    <pre>{text || "—"}</pre>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      )}

      <p className="canvas-footnote">
        <Icon name="copy" size={13} />
        Each part is independently selectable. Paste a correction into a stage, then request changes or continue from the saved cursor.
      </p>
    </div>
  );
}
