"use client";

import type { WorkflowConfig } from "../lib/workflow";

export default function GuidingRules({
  config,
  onChange,
}: {
  config: WorkflowConfig;
  onChange: <K extends keyof WorkflowConfig>(key: K, value: WorkflowConfig[K]) => void;
}) {
  return (
    <div className="rules-panel settings-fields">
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
        </>
      )}
    </div>
  );
}
