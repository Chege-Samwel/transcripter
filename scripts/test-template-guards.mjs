// scripts/test-template-guards.mjs
//
// Verifies the template selection guards and the Output Guide output guards:
// built-in templates are usable as main templates, a partial template cannot
// wipe live rules, a stale templateId is repaired, and the psychiatric template
// actually rejects an incomplete clinical document.
//
// Run with: npm run test:guards

import assert from "node:assert/strict";

const {
  DEFAULT_TEMPLATES,
  DEFAULT_CONFIG,
  DEFAULT_OUTPUT_GUIDE,
  auditOutputAgainstGuide,
  describeExpectation,
  normalizeConfig,
  normalizeOutputGuide,
  sectionChecks,
} = await import("../lib/workflow.ts");

const {
  applyTemplateToConfig,
  auditTemplate,
  buildDeliveryContract,
  guardSummary,
  resolveTemplateId,
  sanitizeTemplateInput,
  templateDrift,
} = await import("../lib/template-guards.ts");

/* ------------------------------------------------------------------ *
 * 1. Every built-in template is a valid main template with armed guards
 * ------------------------------------------------------------------ */
assert.ok(DEFAULT_TEMPLATES.length >= 5, "the built-in library should ship several templates");
for (const template of DEFAULT_TEMPLATES) {
  const audit = auditTemplate(template);
  assert.equal(audit.state, "ready", `${template.name} should be ready: ${audit.issues.map((i) => i.message).join(" | ")}`);
  assert.equal(audit.ok, true);
  assert.ok(audit.guardedChecks >= 1, `${template.name} must arm at least one machine-checkable output guard`);
  assert.equal(audit.totalChecks, template.outputGuide.checks.length);
  for (const check of template.outputGuide.checks) {
    assert.ok(check.id && check.label && check.rule, `${template.name}/${check.id} must be fully described`);
    if (check.expectation) assert.ok(describeExpectation(check.expectation).length > 0);
  }
}
console.log(`✓ ${DEFAULT_TEMPLATES.length} built-in templates pass the template guard as ready main templates`);

/* ------------------------------------------------------------------ *
 * 2. The psychiatric template is complete and its guards are specific
 * ------------------------------------------------------------------ */
const psychiatric = DEFAULT_TEMPLATES.find((t) => t.id === "tpl-psychiatric-evaluation-master");
assert.ok(psychiatric, "the psychiatric template must exist");
const psychAudit = auditTemplate(psychiatric);
assert.equal(psychAudit.state, "ready");
assert.ok(psychAudit.guardedChecks >= 6, "the psychiatric template should guard most of its checks");

const headerCheck = psychiatric.outputGuide.checks.find((c) => c.id === "check-clinical-headers");
assert.equal(headerCheck.expectation.kind, "headers");
for (const header of ["CHIEF COMPLAINT", "HISTORY OF PRESENT ILLNESS", "MENTAL STATUS EXAM", "ASSESSMENT", "RETURN TO CLINIC"]) {
  assert.ok(
    headerCheck.expectation.headers.some((h) => h.toUpperCase() === header.toUpperCase()),
    `psychiatric headers must include ${header}`,
  );
}
// Anti-fabrication guard must exist: no placeholder may ship as a clinical record.
assert.ok(
  psychiatric.outputGuide.checks.some((c) => c.expectation?.kind === "absence" && /tbd/i.test(c.expectation.pattern)),
  "the psychiatric template must block placeholder text",
);
assert.match(psychiatric.formatRules, /\[Not documented\]/, "undocumented fields need an explicit convention");
assert.match(psychiatric.editRules, /Never fabricate/i, "the template must forbid fabrication");
console.log("✓ psychiatric template: ordered headers, checklist, numbering, and fabrication guards are declared");

/* ------------------------------------------------------------------ *
 * 3. Guarded application never lets a blank field wipe live rules
 * ------------------------------------------------------------------ */
const live = normalizeConfig({
  ...DEFAULT_CONFIG,
  formatRules: "Keep the existing format contract intact.",
  editRules: "Keep the existing edit contract intact.",
  masterPrompt: "Keep the existing master prompt intact.",
  outputGuide: DEFAULT_OUTPUT_GUIDE,
});

const halfFilled = {
  id: "tpl-custom-half",
  name: "Half-filled template",
  category: "Custom",
  formatRules: "Only the format rules were filled in by this template author, everything else is blank.",
  editRules: "",
  masterPrompt: "   ",
  outputGuide: undefined,
};

const blockedApply = auditTemplate({ ...halfFilled, outputGuide: halfFilled.outputGuide });
assert.equal(blockedApply.state, "blocked", "a template with no Output Guide must be blocked");
assert.equal(blockedApply.ok, false);

const application = applyTemplateToConfig(live, { ...halfFilled, outputGuide: DEFAULT_OUTPUT_GUIDE });
assert.equal(application.config.formatRules, halfFilled.formatRules, "the filled field is applied");
assert.equal(application.config.editRules, live.editRules, "the blank field is not allowed to wipe the live contract");
assert.equal(application.config.masterPrompt, live.masterPrompt, "whitespace-only fields do not wipe the live contract");
assert.deepEqual(application.kept.sort(), ["Edit rules", "Master prompt"].sort());
assert.ok(application.applied.includes("Output Guide"));
console.log("✓ guarded application keeps existing rules when a template field is blank");

/* ------------------------------------------------------------------ *
 * 4. Selection is repaired when the stored templateId no longer resolves
 * ------------------------------------------------------------------ */
const resolvedMissing = resolveTemplateId(DEFAULT_TEMPLATES, "tpl-custom-deleted-yesterday");
assert.equal(resolvedMissing.repaired, true);
assert.ok(DEFAULT_TEMPLATES.some((t) => t.id === resolvedMissing.id), "a repaired id must point at a real template");
const resolvedDefault = resolveTemplateId(DEFAULT_TEMPLATES, undefined);
assert.equal(resolvedDefault.template?.isDefault, true, "with no selection the default template is used");
const resolvedExact = resolveTemplateId(DEFAULT_TEMPLATES, "tpl-psychiatric-evaluation-master");
assert.equal(resolvedExact.repaired, false);
assert.equal(resolvedExact.id, "tpl-psychiatric-evaluation-master");
console.log("✓ stale templateId selections are repaired to a real template");

/* ------------------------------------------------------------------ *
 * 5. Drift detection against the selected template
 * ------------------------------------------------------------------ */
assert.deepEqual(templateDrift(live, psychiatric), ["Format rules", "Edit rules", "Master prompt", "Output Guide checks"]);
const applied = applyTemplateToConfig(live, psychiatric).config;
assert.deepEqual(templateDrift(applied, psychiatric), [], "a freshly applied template shows no drift");
console.log("✓ contract drift is detected and clears after re-applying the template");

/* ------------------------------------------------------------------ *
 * 6. Output guards judge a real clinical document
 * ------------------------------------------------------------------ */
const completeClinical = `CHIEF COMPLAINT: - Major depressive disorder, recurrent; generalized anxiety disorder
HISTORY OF PRESENT ILLNESS: -
The client is a 78-year-old accompanied by her daughter who reports a two-week decline in mood and sleep. She states "I can't sleep" and endorses crying spells, decreased appetite, and one fall at home. Medical history is significant for a urinary tract infection treated last month.
CURRENT PSYCH MEDICATIONS: -
- Sertraline 50 mg daily
CURRENT NON-PSYCH MEDICATIONS: -
- Amoxicillin 500 mg three times daily
PAST PSYCH MEDICATIONS: - None
PAST PSYCHIATRIC HISTORY: - Denies prior psychiatric hospitalization.
SUBSTANCE ABUSE HISTORY: - Denies tobacco, alcohol, and illicit substance use.
TRAUMA HISTORY: - None reported.
SOCIAL HISTORY / EDUCATIONAL HISTORY: - Born locally, widowed two years ago, retired teacher, lives alone with a supportive daughter nearby.
LEGAL HISTORY: - None.
FAMILY PSYCHIATRIC HISTORY: - Mother had depression.
PAST MEDICAL HISTORY: - UTI, constipation, one mechanical fall.
DRUG ALLERGY: -
- Amoxicillin (rash)
Objective:
Vital Signs: Height: 61 in Weight: 118 (Pounds), BP: 128/74 Pulse: 76 Resp: 16
REVIEW OF SYSTEMS:
Constitutional: Fatigue, decreased appetite.
EYE: No visual complaints.
CARDIOVASCULAR: No chest pain.
RESPIRATORY: No dyspnea.
GASTROINTESTINAL: Constipation.
Endocrine: No polyuria.
MUSCULO-SKELETAL: Uses a walker, unsteady gait.
NEUROLOGICAL: Oriented, no seizures.
Mental Status Exam:
- Appearance: Age-appropriate, uses hearing aids.
- Behavior: Cooperative and engaged.
- Speech: Clear, normal rate.
- Mood: "Sad and tired."
- Affect: Tearful, congruent.
- Thought Process: Linear and goal-directed.
- Thought Content: Denies SI/HI.
- Cognition: Oriented x3, recalls 2 of 3 objects.
- Insight: Fair
- Judgment: Fair
Assessment:
1. Continue sertraline 50 mg daily and reassess in two weeks.
2. Monitor for urinary tract infection recurrence given recent treatment and delirium risk.
3. Normalize grief and provide family psychoeducation with the daughter.
4. Fall prevention review with walker and home safety counseling.
Plan
Psychosocial/ Psychotherapeutic/ Behavioral Assessment (Therapy Add-on only):
Type of therapy used: [] Motivational interviewing [] CBT [x] Supportive therapy
Intervention: Supportive therapy
Total psychotherapy time: - 30
Target Symptoms: Depressed mood and insomnia
Description: Explored grief and loss, provided psychoeducation, and engaged family support.
Goal/Progress: Partial response noted.
Treatment Goals: [x] decrease depressive sx [x] decrease anxiety sx [] decrease psychosis [x] improve coping skills [x] improve treatment compliance [] decrease substance use
Treatment Goals Measured by: [x] decrease episodes of emotional/ behavioral problems [x] improved compliance with treatment [] decrease need for PRN medications [x] positive interactions with peers/family [x] Healthy sleep patterns [x] Healthy eating patterns
Progress Related to Goals: [] good [x] fair [] minimal
Functional Status: [] good [x] fair [] poor
Prognosis: [] good [x] fair [x] guarded [] poor
Disposition: Continue with follow-up care.
RETURN TO CLINIC: [ 4] Week(s) [] Month(s) [] PRN`;

const completeAudit = auditOutputAgainstGuide(completeClinical, psychiatric.outputGuide);
assert.equal(completeAudit.reviewCount, 0, `complete document should pass every guard: ${completeAudit.reports.filter((r) => r.status === "review").map((r) => `${r.label}: ${r.message}`).join(" | ")}`);
assert.equal(completeAudit.overallScore, 100);
assert.ok(completeAudit.reports.every((report) => report.expectation), "every psychiatric check should run a machine-checkable expectation");
console.log("✓ a complete psychiatric evaluation passes all output guards");

// The same document as clinicians and EMR exports actually write it: abbreviated
// "Hx" headers, a "SOCIAL HISTORY/ EDUCATIONAL HX" compound header, markdown
// emphasis, and a SOAP-prefixed " O: REVIEW OF SYSTEMS:". The guard must accept
// all of it, because these spellings appear in real encounter notes.
const realWorldClinical = completeClinical
  .replace("TRAUMA HISTORY: -", "Trauma Hx: -")
  .replace("LEGAL HISTORY: -", "Legal Hx: -")
  .replace("SOCIAL HISTORY / EDUCATIONAL HISTORY: -", "**Social History/ Educational Hx:** -")
  .replace("FAMILY PSYCHIATRIC HISTORY: -", "Family Psych Hx: -")
  .replace("REVIEW OF SYSTEMS:", " O: ROS:")
  .replace("Mental Status Exam:", "MSE:");
const realWorldAudit = auditOutputAgainstGuide(realWorldClinical, psychiatric.outputGuide);
const realWorldHeaders = realWorldAudit.reports.find((report) => report.checkId === "check-clinical-headers");
assert.equal(
  realWorldHeaders.status,
  "pass",
  `abbreviated and EMR-prefixed headers should satisfy the header guard: ${realWorldHeaders.message}`,
);
assert.match(realWorldHeaders.message, /All 20 required sections are present in order/);
console.log("✓ abbreviations, compound headers, emphasis, and SOAP prefixes still satisfy the header guard");

// Guards must not be satisfied by a plausible-looking coincidence: a plan bullet
// that says "Follow up weekly" is not the RETURN TO CLINIC disposition.
const proseFollowUp = completeClinical.replace("RETURN TO CLINIC: [ 4] Week(s) [] Month(s) [] PRN", "Follow up weekly at the facility.");
const proseAudit = auditOutputAgainstGuide(proseFollowUp, psychiatric.outputGuide);
const returnReport = proseAudit.reports.find((report) => report.checkId === "check-return-to-clinic");
assert.equal(returnReport.status, "review", "prose 'follow up' must not satisfy the disposition guard");
// Both the disposition guard and the ordered-header guard must fire — the header
// itself is gone, and no other guard may be disturbed by the swap.
assert.deepEqual(
  proseAudit.reports.filter((report) => report.status === "review").map((report) => report.checkId).sort(),
  ["check-clinical-headers", "check-return-to-clinic"],
);
console.log("✓ a padded prose 'follow up' cannot stand in for the RETURN TO CLINIC line");

// Missing a required section must be caught, not waved through.
const missingMse = completeClinical.replace(/Mental Status Exam:[\s\S]*?Assessment:/, "Assessment:");
const missingAudit = auditOutputAgainstGuide(missingMse, psychiatric.outputGuide);
const headerReport = missingAudit.reports.find((report) => report.checkId === "check-clinical-headers");
assert.equal(headerReport.status, "review");
assert.match(headerReport.message, /Mental Status Exam/);
console.log("✓ a missing clinical section is flagged by the header guard");

// Fabricated placeholder text must be caught.
const placeholders = completeClinical.replace("Assessment:", "Assessment:\n1. [insert impression here]");
const placeholderAudit = auditOutputAgainstGuide(placeholders, psychiatric.outputGuide);
assert.equal(placeholderAudit.reports.find((r) => r.checkId === "check-no-placeholders").status, "review");
console.log("✓ unfilled placeholder text is flagged before it can ship as clinical fact");

// An unmarked checklist means no therapy item is actually recorded.
const unchecked = completeClinical.replace(/\[x\]/g, "[ ]");
const uncheckedAudit = auditOutputAgainstGuide(unchecked, psychiatric.outputGuide);
assert.equal(uncheckedAudit.reports.find((r) => r.checkId === "check-therapy-plan").status, "review");
console.log("✓ an all-unchecked therapy add-on is flagged");

/* ------------------------------------------------------------------ *
 * 7. Section cross-check walks the template's own sections
 * ------------------------------------------------------------------ */
const named = sectionChecks(completeClinical, psychiatric.outputGuide);
const labels = named.map((check) => check.label);
for (const header of ["CHIEF COMPLAINT", "Mental Status Exam", "Assessment", "RETURN TO CLINIC"]) {
  assert.ok(labels.includes(header), `section cross-check should name ${header}, got ${labels.slice(0, 4).join(", ")}…`);
}
assert.ok(named.every((check) => check.status === "pass"), `complete document sections should pass: ${named.filter((c) => c.status === "review").map((c) => `${c.label}: ${c.note}`).join(" | ")}`);

const partial = sectionChecks("Assessment:\n1. Only the assessment was written.", psychiatric.outputGuide);
const requiredHeaders = headerCheck.expectation.headers;
const missingFlags = partial.filter((check) => check.flags.some((flag) => /Missing required section/.test(flag)));
assert.equal(
  missingFlags.length,
  requiredHeaders.length - 1,
  `every section except ASSESSMENT should be reported missing, got ${missingFlags.length}`,
);
assert.ok(missingFlags.some((check) => check.label === "RETURN TO CLINIC"));
assert.ok(partial.every((check) => check.status === "review" || check.label === "Assessment"));
console.log("✓ section guard walks template sections and reports missing ones");

// Dialogue templates still fall back to paragraph walking.
const dialogue = sectionChecks(
  "SPEAKER 1: Welcome to the briefing.\n\nSPEAKER 2: Thank you, glad to be here.",
  DEFAULT_OUTPUT_GUIDE,
);
assert.equal(dialogue.length, 2);
assert.equal(dialogue[0].label, undefined);
console.log("✓ dialogue output still cross-checks by paragraph");

/* ------------------------------------------------------------------ *
 * 8. The delivery contract carries every guard into the prompt
 * ------------------------------------------------------------------ */
const contract = buildDeliveryContract(psychiatric.outputGuide, psychiatric.name);
assert.match(contract, /DELIVERY CONTRACT|OUTPUT GUIDE/);
assert.match(contract, /CHIEF COMPLAINT/);
assert.match(contract, /Machine-checked delivery expectations/);
assert.match(contract, /RETURN TO CLINIC/);
assert.match(contract, /DRUG ALLERGY/);
console.log("✓ the delivery contract injected into every pass lists the armed guards");

/* ------------------------------------------------------------------ *
 * 9. Guard summary + sanitisation + template audit blockers
 * ------------------------------------------------------------------ */
const summary = guardSummary(psychiatric.outputGuide);
assert.equal(summary.totalChecks, psychiatric.outputGuide.checks.length);
assert.equal(summary.guardedChecks, psychiatric.outputGuide.checks.filter((c) => c.expectation).length);
assert.ok(summary.expectations.length >= 6);

const sanitized = sanitizeTemplateInput({ name: "  Padded  ", formatRules: "x".repeat(50_000) });
assert.equal(sanitized.name, "Padded");
assert.equal(sanitized.formatRules.length, 20_000, "unbounded template fields are capped");

assert.equal(auditTemplate({ name: "", formatRules: "", editRules: "", masterPrompt: "" }).ok, false);
assert.equal(auditTemplate({ ...DEFAULT_TEMPLATES[0], name: "" }).state, "blocked");
console.log("✓ guard summary, field sanitisation, and blocked templates behave");

/* ------------------------------------------------------------------ *
 * 10. Expectation round-trips through normalisation (DB / import path)
 * ------------------------------------------------------------------ */
const roundTrip = normalizeOutputGuide(JSON.parse(JSON.stringify(psychiatric.outputGuide)));
assert.equal(roundTrip.checks.length, psychiatric.outputGuide.checks.length);
assert.equal(roundTrip.checks.filter((c) => c.expectation).length, summary.guardedChecks);
assert.deepEqual(roundTrip.checks.find((c) => c.id === "check-clinical-headers").expectation.headers, headerCheck.expectation.headers);

const roundTripHeaders = roundTrip.checks.find((c) => c.id === "check-clinical-headers").expectation;
assert.deepEqual(
  roundTripHeaders.aliases,
  headerCheck.expectation.aliases,
  "clinical header aliases must survive the database / import round-trip",
);
assert.ok(roundTripHeaders.aliases["TRAUMA HISTORY"].includes("TRAUMA HX"));
// Aliases may only ever be attached to a header the check actually requires.
const strayAliases = normalizeOutputGuide({
  ...DEFAULT_OUTPUT_GUIDE,
  checks: [
    {
      id: "stray",
      label: "Stray aliases",
      description: "",
      rule: "",
      category: "structure",
      expectation: {
        kind: "headers",
        headers: ["PLAN"],
        aliases: { PLAN: ["TREATMENT PLAN"], "NOT REQUIRED": ["GHOST"], PLANX: "not an array" },
      },
    },
  ],
}).checks[0].expectation;
assert.deepEqual(Object.keys(strayAliases.aliases), ["PLAN"], "aliases for headers that are not required are dropped");
assert.deepEqual(strayAliases.aliases.PLAN, ["TREATMENT PLAN"]);
assert.equal(auditOutputAgainstGuide("PLAN\n1. Continue.", { ...DEFAULT_OUTPUT_GUIDE, checks: [{ id: "stray", label: "Stray aliases", description: "", rule: "", category: "structure", expectation: strayAliases }] }).reports[0].status, "pass");

const invalidExpectation = normalizeOutputGuide({
  ...DEFAULT_OUTPUT_GUIDE,
  checks: [{ id: "bad", label: "Bad regex", description: "", rule: "", category: "structure", expectation: { kind: "regex", pattern: "([unclosed" } }],
});
assert.equal(invalidExpectation.checks[0].expectation, undefined, "an uncompilable pattern is dropped rather than breaking the audit");
console.log("✓ expectations survive serialisation and invalid patterns are dropped");

console.log("\nAll template guard and output guard checks passed.");
