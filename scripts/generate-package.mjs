import fs from "node:fs/promises";
import { execSync } from "node:child_process";

async function main() {
  const templatePayload = {
    type: "transcripter-workflow-template",
    version: 1,
    exportedAt: new Date().toISOString(),
    template: {
      id: "tpl-direct-response-master",
      name: "Direct Response & Editorial Transcription Master",
      description: "Comprehensive direct response and editorial transcription template covering formatting contracts, editing rules, and quality assurance output guides for publication-ready dialogue.",
      category: "Direct Response",
      isDefault: false,
      formatRules: `1. Format all dialogue with UPPERCASE speaker labels followed by a colon (e.g., SPEAKER 1:, INTERVIEWER:, HOST:, GUEST:) on a fresh paragraph.
2. Break long conversational statements into readable paragraphs at natural pauses (maximum 120 words per paragraph).
3. Maintain chronological sequence. Do not merge separate speaker exchanges into a single block.
4. Preserve timestamps if present in the source transcript (e.g., [00:14:22]).`,
      editRules: `1. Polish grammar, syntax, and sentence flow while strictly preserving speaker authenticity, intent, tone, and vocabulary.
2. Remove disfluencies, accidental stutters, and meaningless filler expressions (e.g., "um", "uh", "like", "you know") unless they convey vital emotional hesitation or direct response emphasis.
3. Strictly preserve all technical terms, marketing claims, numerical metrics, percentages, currency, dates, and proper names.
4. Retain and standardize uncertainty markers ([inaudible], [crosstalk], [laughter]). Never invent unsaid words to fill gaps.`,
      masterPrompt: `You are an elite direct response editorial transcription specialist. Accuracy, speaker integrity, and clarity are non-negotiable. Never fabricate words not supported by the source, never alter quantitative data or claims, and return only the processed transcript for the supplied batch.`,
      outputGuide: {
        title: "Direct Response Publication & Quality Standards",
        description: "Strict quality control audit for speaker attribution, conversational rhythm, verbatim preservation, and terminal punctuation.",
        speakerFormat: "UPPERCASE speaker label followed by a colon (e.g., SPEAKER 1:, HOST:) on a fresh paragraph.",
        paragraphRules: "Paragraphs under 120 words with clear double-line breaks between speaker turns. No continuous unbroken text walls.",
        punctuationRules: "Ensure proper terminal punctuation on every statement (. ! ?). Use em-dashes (—) for speech interruptions and ellipsis (...) for trailing thoughts.",
        uncertaintyMarkers: "Preserve [inaudible], [crosstalk], and [laughter] tags. Flag any unresolved markers for human review.",
        editorialNotes: "Clean verbatim polish: remove meaningless filler words while maintaining exact rhetorical power and factual accuracy.",
        checks: [
          {
            id: "check-speakers",
            label: "Speaker Attribution & Consistency",
            description: "Verifies every speaker statement begins with an uppercase label and colon.",
            rule: "Standardized uppercase label followed by colon (e.g. SPEAKER 1:).",
            category: "speaker",
          },
          {
            id: "check-paragraphs",
            label: "Paragraph Pacing & Readability",
            description: "Ensures paragraphs remain under 120 words for optimal reading flow.",
            rule: "Paragraphs under 120 words with double line break between speaker turns.",
            category: "structure",
          },
          {
            id: "check-markers",
            label: "Uncertainty & Inaudible Marker Audit",
            description: "Audits [inaudible], [crosstalk], or bracketed review notations.",
            rule: "Preserve [inaudible] and [crosstalk] tags without hallucinating missing text.",
            category: "verbatim",
          },
          {
            id: "check-punctuation",
            label: "Sentence Boundaries & Terminal Punctuation",
            description: "Ensures all sentences and speaker turns end with proper terminal punctuation.",
            rule: "Terminal punctuation required at the end of each paragraph and statement (. ! ?).",
            category: "punctuation",
          },
          {
            id: "check-repetition",
            label: "Repetition & Stutter Filter",
            description: "Cleans accidental duplicate words while keeping intentional stylistic emphasis.",
            rule: "No unintentional consecutive repeated words.",
            category: "formatting",
          },
        ],
      },
      sampleInput: `SPEAKER 1: um so welcome everyone to today's direct response briefing uh we're looking at our recent campaign performance and the conversion rates were up about 14% over baseline... 

SPEAKER 2: yeah absolutely and when you look at the customer retention metrics that we tracked across August they exceeded our initial target by almost 200 basis points so the copy adjustments clearly resonated.`,
      sampleOutput: `SPEAKER 1: Welcome everyone to today's direct response briefing. We are looking at our recent campaign performance, and the conversion rates were up about 14% over baseline.

SPEAKER 2: Absolutely. When you look at the customer retention metrics that we tracked across August, they exceeded our initial target by almost 200 basis points, so the copy adjustments clearly resonated.`,
    },
  };

  // 1. Write standalone template JSON file
  await fs.writeFile(
    "direct-response-template.workflow-template.json",
    JSON.stringify(templatePayload, null, 2),
    "utf8"
  );

  // 2. Write sample v.txt file
  const sampleVTxt = `SPEAKER 1: Welcome everyone. In today's session, we are analyzing the direct response marketing results for our new product launch. The initial customer acquisition costs were projected at $45, but through our targeted email sequence and optimized sales letter, we brought that down to $28.50 per acquisition.

SPEAKER 2: That's a significant improvement. What was the impact on customer lifetime value during the first sixty days?

SPEAKER 1: Our 60-day customer lifetime value rose from $112 to $168, largely driven by the immediate upsell funnel and our automated onboarding sequence.

SPEAKER 2: Excellent. Let's make sure the editorial transcript reflects these exact figures so our media buyers and copywriters can review the campaign mechanics without discrepancy.`;

  await fs.writeFile("v.txt", sampleVTxt, "utf8");

  // Also write template.json
  await fs.writeFile("template.json", JSON.stringify(templatePayload, null, 2), "utf8");
  await fs.writeFile("rules.txt", `${templatePayload.template.formatRules}\n\n${templatePayload.template.editRules}`, "utf8");

  // Create ZIP with v.txt and template.json
  try {
    execSync("zip -q -9 v-transcript-package.zip v.txt template.json rules.txt");
    console.log("✓ Created v-transcript-package.zip successfully using system zip.");
  } catch (err) {
    console.error("Could not run zip command", err);
  }

  console.log("✓ Generated direct-response-template.workflow-template.json, v.txt, and v-transcript-package.zip successfully!");
}

main().catch(console.error);
