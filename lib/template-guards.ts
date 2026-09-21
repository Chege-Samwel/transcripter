/**
 * Template selection guards.
 *
 * A template carries the format rules, edit rules, master prompt and Output
 * Guide that every pass inherits. These guards make that inheritance safe:
 *
 *  - `auditTemplate`      — is this template complete enough to be a main
 *                           template, and does every Output Guide check carry a
 *                           machine-checkable expectation (an output guard)?
 *  - `applyTemplateToConfig` — apply a template onto the live config without
 *                           letting an empty field silently wipe existing rules.
 *  - `resolveTemplateId`  — keep `config.templateId` pointing at a template that
 *                           actually exists, including drafts and imports.
 *  - `templateDrift`      — has the job's config drifted away from the template
 *                           contract that was selected?
 *  - `guardSummary`       — a compact badge-friendly summary of the active
 *                           output guards.
 */

import {
  describeExpectation,
  type OutputGuide,
  type OutputGuideCheck,
  type WorkflowConfig,
  type WorkflowTemplate,
} from "./workflow";

export type TemplateGuardIssue = {
  level: "error" | "warning";
  field: string;
  message: string;
};

export type TemplateAudit = {
  templateId: string;
  name: string;
  /** `ready` = usable as a main template, `review` = usable with warnings, `blocked` = incomplete. */
  state: "ready" | "review" | "blocked";
  ok: boolean;
  score: number;
  issues: TemplateGuardIssue[];
  /** Output Guide checks that carry a machine-checkable expectation. */
  guardedChecks: number;
  totalChecks: number;
};

const MIN_RULE_LENGTH = 40;
const MIN_PROMPT_LENGTH = 40;
const MAX_FIELD_LENGTH = 20_000;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Guardrail: strip unbounded or non-string fields from an incoming template. */
export function sanitizeTemplateInput(input: Partial<WorkflowTemplate>): Partial<WorkflowTemplate> {
  const clean = (value: unknown) => (typeof value === "string" ? value.slice(0, MAX_FIELD_LENGTH) : undefined);
  return {
    ...input,
    name: text(input.name).slice(0, 160),
    description: clean(input.description)?.trim(),
    category: text(input.category).slice(0, 80) || "Custom",
    formatRules: clean(input.formatRules),
    editRules: clean(input.editRules),
    masterPrompt: clean(input.masterPrompt),
    sampleInput: clean(input.sampleInput),
    sampleOutput: clean(input.sampleOutput),
  };
}

/**
 * Audit a template before it is used as a main template or saved to the library.
 * `blocked` templates must not be applied; `review` templates may be applied but
 * the surface reports exactly what is missing.
 */
export function auditTemplate(template: Partial<WorkflowTemplate>): TemplateAudit {
  const issues: TemplateGuardIssue[] = [];
  const name = text(template.name);
  const category = text(template.category);
  const formatRules = text(template.formatRules);
  const editRules = text(template.editRules);
  const masterPrompt = text(template.masterPrompt);
  const guide = template.outputGuide;
  const checks: OutputGuideCheck[] = Array.isArray(guide?.checks) ? guide!.checks : [];

  if (!name) issues.push({ level: "error", field: "name", message: "A template needs a name before it can be applied." });
  if (!formatRules) {
    issues.push({ level: "error", field: "formatRules", message: "Format rules are empty — the layout contract would not be enforced." });
  } else if (formatRules.length < MIN_RULE_LENGTH) {
    issues.push({ level: "warning", field: "formatRules", message: "Format rules are very short; the model may improvise the layout." });
  }
  if (!editRules) {
    issues.push({ level: "error", field: "editRules", message: "Edit rules are empty — preservation and non-invention limits would be lost." });
  } else if (editRules.length < MIN_RULE_LENGTH) {
    issues.push({ level: "warning", field: "editRules", message: "Edit rules are very short; preservation limits may be too loose." });
  }
  if (!masterPrompt) {
    issues.push({ level: "error", field: "masterPrompt", message: "The master prompt is empty — every pass would run without its non-negotiable instruction." });
  } else if (masterPrompt.length < MIN_PROMPT_LENGTH) {
    issues.push({ level: "warning", field: "masterPrompt", message: "The master prompt is very short; add the role and hard constraints." });
  }
  if (!guide) {
    issues.push({ level: "error", field: "outputGuide", message: "This template has no Output Guide, so the delivered output cannot be guarded." });
  } else {
    if (!text(guide.title)) issues.push({ level: "warning", field: "outputGuide.title", message: "Give the Output Guide a title so the canvas audit is identifiable." });
    if (!text(guide.speakerFormat)) {
      issues.push({ level: "warning", field: "outputGuide.speakerFormat", message: "No speaker/section format is declared, so label consistency cannot be checked." });
    }
    if (checks.length === 0) {
      issues.push({ level: "error", field: "outputGuide.checks", message: "The Output Guide has no verification checks; add at least one." });
    }
  }

  if (!category) issues.push({ level: "warning", field: "category", message: "No category set; the template will be grouped under Custom." });

  const seenIds = new Set<string>();
  let hasExpectation = false;
  for (const check of checks) {
    const id = text(check.id);
    const label = text(check.label);
    if (!label) issues.push({ level: "warning", field: "outputGuide.checks", message: "A verification check has no label." });
    if (id) {
      if (seenIds.has(id)) issues.push({ level: "warning", field: "outputGuide.checks", message: `Duplicate check id "${id}" — the audit report will be ambiguous.` });
      seenIds.add(id);
    }
    if (!text(check.rule)) {
      issues.push({ level: "warning", field: "outputGuide.checks", message: `Check "${label || id || "unnamed"}" has no rule text.` });
    }
    // A guide whose checks are all broad category heuristics gives weak output
    // guarantees; every template should ship at least one precise expectation.
    if (check.expectation) hasExpectation = true;
  }
  if (checks.length > 0 && !hasExpectation) {
    issues.push({
      level: "warning",
      field: "outputGuide.checks",
      message: "No check declares a machine-checkable expectation, so output guards fall back to loose category heuristics. Add an `expectation` (headers, checklist, regex, absence…) to at least one check.",
    });
  }

  const errors = issues.filter((issue) => issue.level === "error");
  const warnings = issues.filter((issue) => issue.level === "warning");
  const guardedChecks = checks.filter((check) => Boolean(check.expectation)).length;
  const score = Math.max(0, 100 - errors.length * 34 - warnings.length * 9);

  return {
    templateId: text(template.id) || "unsaved",
    name: name || "Untitled template",
    state: errors.length ? "blocked" : warnings.length ? "review" : "ready",
    ok: errors.length === 0,
    score,
    issues,
    guardedChecks,
    totalChecks: checks.length,
  };
}

export type TemplateApplication = {
  config: WorkflowConfig;
  /** Fields taken from the template. */
  applied: string[];
  /** Fields the template left blank, so the existing value was kept. */
  kept: string[];
};

/**
 * Apply a template's contract onto the live workflow config.
 *
 * Guardrail: blank template fields never overwrite existing rules. This is what
 * stops a half-filled template (or an imported JSON with missing keys) from
 * silently erasing the editorial direction that is currently in force.
 */
export function applyTemplateToConfig(
  current: WorkflowConfig,
  template: WorkflowTemplate
): TemplateApplication {
  const next: WorkflowConfig = { ...current, outputGuide: { ...current.outputGuide, checks: [...current.outputGuide.checks] } };
  const applied: string[] = [];
  const kept: string[] = [];

  const carry = (key: "formatRules" | "editRules" | "masterPrompt", label: string) => {
    const value = text(template[key]);
    if (value) {
      next[key] = value;
      applied.push(label);
    } else {
      kept.push(label);
    }
  };

  carry("formatRules", "Format rules");
  carry("editRules", "Edit rules");
  carry("masterPrompt", "Master prompt");

  if (template.name?.trim()) {
    next.name = template.name.trim();
    next.description = template.description?.trim() || next.description;
    applied.push("Template name");
  }

  if (template.outputGuide && Array.isArray(template.outputGuide.checks) && template.outputGuide.checks.length > 0) {
    next.outputGuide = {
      ...template.outputGuide,
      checks: template.outputGuide.checks.map((check) => ({ ...check })),
    };
    applied.push("Output Guide");
  } else {
    kept.push("Output Guide");
  }

  next.templateId = template.id;
  return { config: next, applied, kept };
}

/** Which rule fields differ from the selected template's contract. */
export function templateDrift(config: WorkflowConfig, template?: WorkflowTemplate | null): string[] {
  if (!template) return [];
  const drift: string[] = [];
  if (text(template.formatRules) && text(config.formatRules) !== text(template.formatRules)) drift.push("Format rules");
  if (text(template.editRules) && text(config.editRules) !== text(template.editRules)) drift.push("Edit rules");
  if (text(template.masterPrompt) && text(config.masterPrompt) !== text(template.masterPrompt)) drift.push("Master prompt");
  const templateChecks = template.outputGuide?.checks || [];
  if (templateChecks.length && config.outputGuide?.checks?.length !== templateChecks.length) drift.push("Output Guide checks");
  return drift;
}

/** Keep the selected template id resolvable after loads, imports, and deletes. */
export function resolveTemplateId(
  templates: WorkflowTemplate[],
  requestedId?: string
): { id: string; template?: WorkflowTemplate; repaired: boolean } {
  if (!templates.length) return { id: "", template: undefined, repaired: false };
  const match = requestedId ? templates.find((template) => template.id === requestedId) : undefined;
  if (match) return { id: match.id, template: match, repaired: false };
  const fallback = templates.find((template) => template.isDefault) || templates[0];
  return { id: fallback.id, template: fallback, repaired: Boolean(requestedId) };
}

export type GuardSummary = {
  totalChecks: number;
  guardedChecks: number;
  expectations: string[];
  categories: string[];
};

/** Badge-friendly summary of what the active template actually guards. */
export function guardSummary(guide?: OutputGuide | null): GuardSummary {
  const checks = guide?.checks || [];
  const expectations = checks
    .map((check) => check.expectation)
    .filter((expectation): expectation is NonNullable<typeof expectation> => Boolean(expectation))
    .map((expectation) => describeExpectation(expectation));
  return {
    totalChecks: checks.length,
    guardedChecks: expectations.length,
    expectations,
    categories: Array.from(new Set(checks.map((check) => check.category))),
  };
}

/**
 * Plain-language delivery contract injected into every model pass so the output
 * guards are enforced while the text is generated, not only after the fact.
 */
export function buildDeliveryContract(guide: OutputGuide, templateName?: string): string {
  const lines: string[] = [
    templateName ? `Active template: ${templateName}` : "",
    `OUTPUT GUIDE — ${guide.title}`,
    guide.description ? guide.description : "",
    `Speaker / section format: ${guide.speakerFormat}`,
    `Paragraph rules: ${guide.paragraphRules}`,
    `Punctuation rules: ${guide.punctuationRules}`,
    `Uncertainty markers: ${guide.uncertaintyMarkers}`,
    guide.editorialNotes ? `Editorial notes: ${guide.editorialNotes}` : "",
    "Mandatory verification checks (all must be satisfied by your output):",
    ...guide.checks.map((check) => `- ${check.label}: ${check.rule}`),
    "Machine-checked delivery expectations (failing any of these flags the pass for human review):",
    ...guide.checks
      .map((check) => check.expectation)
      .filter((expectation): expectation is NonNullable<typeof expectation> => Boolean(expectation))
      .map((expectation) => `- ${describeExpectation(expectation)}`),
  ];
  return lines.filter(Boolean).join("\n");
}
