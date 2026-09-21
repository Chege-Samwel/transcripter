"use client";

import {
  applyTemplateToConfig,
  guardSummary,
  templateDrift,
} from "../lib/template-guards";
import type { WorkflowConfig, WorkflowTemplate } from "../lib/workflow";

export default function GuidingRules({
  config,
  onChange,
  template,
}: {
  config: WorkflowConfig;
  onChange: <K extends keyof WorkflowConfig>(key: K, value: WorkflowConfig[K]) => void;
  /** Active template, so the panel can show armed output guards and contract drift. */
  template?: WorkflowTemplate;
}) {
  const guards = guardSummary(config.outputGuide);
  const drift = templateDrift(config, template);

  function restoreContract() {
    if (!template) return;
    const restored = applyTemplateToConfig(config, template).config;
    onChange("formatRules", restored.formatRules);
    onChange("editRules", restored.editRules);
    onChange("masterPrompt", restored.masterPrompt);
    onChange("outputGuide", restored.outputGuide);
  }

  return (
    <div className="rules-panel settings-fields">
      {template && drift.length > 0 && (
        <div
          style={{
            marginBottom: "10px",
            padding: "8px 10px",
            borderRadius: "6px",
            border: "1px solid #f0dca0",
            background: "#fff8e1",
            color: "#8a5300",
            fontSize: "11px",
            lineHeight: 1.5,
          }}
        >
          These rules no longer match <strong>{template.name}</strong> ({drift.join(", ")}). The output guards below still run, but they no longer
          describe this template.
          <button
            type="button"
            onClick={restoreContract}
            style={{ marginLeft: "8px", fontSize: "10px", padding: "2px 8px", borderRadius: "4px", border: "1px solid #f0dca0", background: "#fff", color: "#8a5300", cursor: "pointer", fontWeight: 700 }}
          >
            Restore template contract
          </button>
        </div>
      )}

      <label>
        Format rules
        <span className="field-description">Structure, labels, line breaks, and presentation.</span>
        <textarea className="large-control" value={config.formatRules} onChange={(event) => onChange("formatRules", event.target.value)} />
      </label>
      <label>
        Edit rules
        <span className="field-description">How much to polish, what to preserve, and what not to invent.</span>
        <textarea className="large-control" value={config.editRules} onChange={(event) => onChange("editRules", event.target.value)} />
      </label>
      <label>
        Master prompt
        <span className="field-description">The non-negotiable instruction prepended to every pass.</span>
        <textarea className="master-control" value={config.masterPrompt} onChange={(event) => onChange("masterPrompt", event.target.value)} />
      </label>
      {config.outputGuide && (
        <>
          <label>
            Output Guide: Speaker format
            <span className="field-description">Speaker tag specifications for final canvas rendering.</span>
            <input
              value={config.outputGuide.speakerFormat}
              onChange={(e) =>
                onChange("outputGuide", {
                  ...config.outputGuide,
                  speakerFormat: e.target.value,
                })
              }
            />
          </label>
          <label>
            Output Guide: Paragraph rules
            <span className="field-description">Paragraph bounds and conversational pause breaks.</span>
            <input
              value={config.outputGuide.paragraphRules}
              onChange={(e) =>
                onChange("outputGuide", {
                  ...config.outputGuide,
                  paragraphRules: e.target.value,
                })
              }
            />
          </label>

          {/* Output guards: what the delivered text is actually checked against. */}
          <div
            style={{
              padding: "10px 12px",
              borderRadius: "6px",
              border: "1px solid var(--line-soft)",
              background: "var(--surface)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: "8px", fontSize: "11px", fontWeight: 700 }}>
              <span>OUTPUT GUARDS · {config.outputGuide.title}</span>
              <span title="Checks carrying a machine-checkable expectation">
                {guards.guardedChecks}/{guards.totalChecks} armed
              </span>
            </div>
            {guards.expectations.length > 0 ? (
              <ul style={{ margin: "6px 0 0", paddingLeft: "18px", fontSize: "11px", color: "var(--muted)", lineHeight: 1.55 }}>
                {guards.expectations.map((expectation) => (
                  <li key={expectation}>{expectation}</li>
                ))}
              </ul>
            ) : (
              <p style={{ margin: "6px 0 0", fontSize: "11px", color: "var(--muted)" }}>
                This guide has no machine-checkable expectations, so the canvas falls back to loose category heuristics. Add an expectation in Settings to
                make each check enforceable.
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
