"use client";

import { useMemo, useState } from "react";
import CopyButton from "./CopyButton";
import Icon from "./Icon";
import type { JobRecord } from "../lib/types";
import {
  auditOutputAgainstGuide,
  DEFAULT_OUTPUT_GUIDE,
  formatNumber,
  type OutputGuide,
} from "../lib/workflow";

type CanvasKey = "all" | "source" | "normalize" | "format" | "edit" | "refine" | "batches";
type OutputDisplayMode = "guided" | "raw" | "audit";

function highlightMarkers(text: string) {
  const parts = text.split(/(\[(?:inaudible|crosstalk|unintelligible|laughter|applause|music|\?)[^\]]*\]|\bTODO\b|\?{3,})/gi);
  if (parts.length === 1) return text;

  return parts.map((part, index) => {
    if (/^(\[|\bTODO|\?{3,})/i.test(part)) {
      return (
        <mark key={`mark-${index}`} className="canvas-marker-chip" title="Uncertainty / transcript marker">
          {part}
        </mark>
      );
    }
    return part;
  });
}

export default function EditsCanvas({
  job,
  onChangePart,
}: {
  job: JobRecord;
  onChangePart: (part: "source" | "normalize" | "format" | "edit" | "refine", value: string) => void;
}) {
  const guide: OutputGuide = job.config?.outputGuide || DEFAULT_OUTPUT_GUIDE;

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
  const [outputMode, setOutputMode] = useState<OutputDisplayMode>("guided");
  const [showGuideDetails, setShowGuideDetails] = useState(false);

  const visible = tab === "all" || tab === "batches" ? parts : parts.filter((part) => part.key === tab);

  // The last/final output text
  const finalOutput = job.stages.refine || job.stages.edit || job.result || "";

  // Audit of the last output against the Output Guide
  const audit = useMemo(() => {
    return auditOutputAgainstGuide(finalOutput, guide);
  }, [finalOutput, guide]);

  // Parse final output into speaker turns & paragraphs for the Guided View
  const guidedBlocks = useMemo(() => {
    if (!finalOutput.trim()) return [];
    const paragraphs = finalOutput.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const speakerRegex = /^([A-Z0-9 _-]{1,30})\s*:\s*([\s\S]*)$/;

    return paragraphs.map((paragraph, index) => {
      const match = paragraph.match(speakerRegex);
      if (match) {
        return {
          id: `block-${index}`,
          speaker: match[1].trim(),
          content: match[2].trim(),
        };
      }
      return {
        id: `block-${index}`,
        speaker: null,
        content: paragraph,
      };
    });
  }, [finalOutput]);

  const speakerCount = useMemo(() => {
    const speakers = new Set(guidedBlocks.map((b) => b.speaker).filter(Boolean));
    return speakers.size;
  }, [guidedBlocks]);

  return (
    <div className="canvas-shell">
      {/* Output Guide Topline Bar */}
      <div className="canvas-guide-topbar">
        <div className="canvas-guide-meta">
          <div className="canvas-guide-badge">
            <Icon name="book" size={14} />
            <span>Output Guide:</span>
            <strong>{guide.title}</strong>
          </div>
          <button
            type="button"
            className="canvas-guide-link"
            onClick={() => setShowGuideDetails((prev) => !prev)}
          >
            {showGuideDetails ? "Hide guide specs" : "View output specs"}
            <Icon name="chevron" size={12} />
          </button>
        </div>

        {finalOutput && (
          <div className="canvas-guide-compliance">
            <span className={`compliance-tag ${audit.reviewCount === 0 ? "pass" : "review"}`}>
              <Icon name={audit.reviewCount === 0 ? "check" : "spark"} size={12} />
              {audit.reviewCount === 0 ? "Guide Compliant (100%)" : `${audit.passedCount}/${guide.checks.length} checks passed`}
            </span>
          </div>
        )}
      </div>

      {/* Expandable Output Guide Details Drawer */}
      {showGuideDetails && (
        <div className="card canvas-guide-drawer">
          <div className="card-topline">
            <p className="overline">CANVAS OUTPUT SPECIFICATION</p>
            <span className="badge">{guide.checks.length} quality checks</span>
          </div>
          <p style={{ margin: "4px 0 14px", color: "var(--muted)", fontSize: "11px", lineHeight: "1.5" }}>
            {guide.description}
          </p>

          <div className="canvas-guide-grid">
            <div className="guide-spec-box">
              <span className="overline">SPEAKER FORMATTING</span>
              <p>{guide.speakerFormat}</p>
            </div>
            <div className="guide-spec-box">
              <span className="overline">PARAGRAPH RHYTHM</span>
              <p>{guide.paragraphRules}</p>
            </div>
            <div className="guide-spec-box">
              <span className="overline">PUNCTUATION &amp; PAUSES</span>
              <p>{guide.punctuationRules}</p>
            </div>
            <div className="guide-spec-box">
              <span className="overline">UNCERTAINTY TAGS</span>
              <p>{guide.uncertaintyMarkers}</p>
            </div>
          </div>
        </div>
      )}

      {/* Stage Tabs */}
      <div className="canvas-tabs" role="tablist" aria-label="Edit stages">
        <button type="button" className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
          All parts
        </button>
        {parts.map((part) => (
          <button
            type="button"
            className={tab === part.key ? "active" : ""}
            key={part.key}
            onClick={() => setTab(part.key)}
          >
            {part.label}
          </button>
        ))}
        {job.batches.length > 0 && (
          <button type="button" className={tab === "batches" ? "active" : ""} onClick={() => setTab("batches")}>
            Batches
          </button>
        )}
      </div>

      {/* Main Canvas Views */}
      {tab !== "batches" && (
        <div className={`canvas-grid ${tab === "all" ? "stacked" : "single"}`}>
          {visible.map((part) => {
            const isFinalStage = part.key === "edit" || part.key === "refine";

            return (
              <article className="card canvas-card" key={part.key}>
                <div className="output-topline">
                  <span>
                    <i />
                    {part.label.toUpperCase()}
                    <em>{part.hint}</em>
                  </span>

                  <div className="canvas-card-actions">
                    {/* Mode toggles for final output stages */}
                    {isFinalStage && part.text && (
                      <div className="canvas-mode-toggle" role="group" aria-label="Output view mode">
                        <button
                          type="button"
                          className={outputMode === "guided" ? "active" : ""}
                          onClick={() => setOutputMode("guided")}
                          title="Display output styled according to the Output Guide"
                        >
                          <Icon name="spark" size={11} /> Guided View
                        </button>
                        <button
                          type="button"
                          className={outputMode === "raw" ? "active" : ""}
                          onClick={() => setOutputMode("raw")}
                          title="Raw editable text"
                        >
                          Raw Editor
                        </button>
                        <button
                          type="button"
                          className={outputMode === "audit" ? "active" : ""}
                          onClick={() => setOutputMode("audit")}
                          title="Inspect Output Guide compliance checks"
                        >
                          <Icon name="check" size={11} /> Guide Audit ({audit.passedCount}/{guide.checks.length})
                        </button>
                      </div>
                    )}

                    <span>{formatNumber(part.text.length)} chars</span>
                    <CopyButton text={part.text} label={`Copy ${part.label.toLowerCase()}`} />
                  </div>
                </div>

                {/* If final stage and guided view is selected */}
                {isFinalStage && outputMode === "guided" && part.text ? (
                  <div className="canvas-guided-container">
                    <div className="guided-stats-ribbon">
                      <span><strong>{formatNumber(part.text.split(/\s+/).filter(Boolean).length)}</strong> words</span>
                      <span><strong>{guidedBlocks.length}</strong> paragraphs</span>
                      {speakerCount > 0 && <span><strong>{speakerCount}</strong> speakers</span>}
                      <span className="guided-spec-tag">Styled via: {guide.title}</span>
                    </div>

                    <div className="canvas-guided-content">
                      {guidedBlocks.map((block) => (
                        <div key={block.id} className="guided-transcript-paragraph">
                          {block.speaker ? (
                            <div className="guided-speaker-row">
                              <span className="guided-speaker-chip">{block.speaker}</span>
                              <div className="guided-speaker-text">{highlightMarkers(block.content)}</div>
                            </div>
                          ) : (
                            <p className="guided-standard-text">{highlightMarkers(block.content)}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : isFinalStage && outputMode === "audit" && part.text ? (
                  /* Output Guide Audit Checklist View */
                  <div className="canvas-audit-container">
                    <div className="audit-header">
                      <div>
                        <h3>Output Guide Verification</h3>
                        <p>Evaluates the last output against the active workflow output guide specifications.</p>
                      </div>
                      <div className="audit-score-card">
                        <strong>{audit.overallScore}%</strong>
                        <span>Compliance score</span>
                      </div>
                    </div>

                    <div className="audit-checks-list">
                      {audit.reports.map((report) => (
                        <div key={report.checkId} className={`audit-check-card ${report.status}`}>
                          <div className="audit-check-title-row">
                            <div className="audit-check-name">
                              <span className={`audit-status-dot ${report.status}`} />
                              <strong>{report.label}</strong>
                            </div>
                            <span className={`badge ${report.status === "pass" ? "approved" : "awaiting_approval"}`}>
                              {report.status === "pass" ? "Pass" : "Review"}
                            </span>
                          </div>
                          <p className="audit-check-msg">{report.message}</p>
                          {report.samples && report.samples.length > 0 && (
                            <div className="audit-samples">
                              <small>Findings:</small>
                              {report.samples.map((s, idx) => (
                                <code key={idx}>{s}</code>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  /* Default / Raw Editable Textarea */
                  <textarea
                    value={part.text}
                    onChange={(event) => onChangePart(part.key, event.target.value)}
                    spellCheck={false}
                    aria-label={part.label}
                    placeholder={`${part.label} will appear here after this pass finishes. You can paste a correction at any time.`}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Batches view */}
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
        Output is formatted and verified according to the workflow Output Guide. Switch between Guided View, Raw Editor, or Guide Audit anytime.
      </p>
    </div>
  );
}
