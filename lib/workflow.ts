export type StageKey = "normalize" | "format" | "edit";
export type TraceStatus = "queued" | "running" | "success" | "error";

export type OutputGuideCheck = {
  id: string;
  label: string;
  description: string;
  rule: string;
  category: "speaker" | "structure" | "punctuation" | "verbatim" | "formatting";
  /**
   * Machine-checkable expectation. When present it is evaluated exactly against
   * the delivered output; when absent the category heuristic is used instead.
   * This is what turns a template's Output Guide into an enforceable guard.
   */
  expectation?: OutputGuideExpectation;
};

/**
 * Deterministic, machine-checkable delivery expectations attached to an Output
 * Guide check. Every kind is evaluated against the finished transcript, so a
 * template cannot silently "pass" without producing the required structure.
 */
export type OutputGuideExpectation =
  /** Every listed header must appear, in order. */
  | {
      kind: "headers";
      headers: string[];
      caseSensitive?: boolean;
      /** Accepted spelling variants per required header, e.g. "TRAUMA HISTORY": ["TRAUMA HX"]. */
      aliases?: Record<string, string[]>;
    }
  /** At least `minItems` numbered lines such as "1." / "1)" must appear. */
  | { kind: "numbered"; minItems?: number }
  /** At least `minBoxes` checkbox tokens such as "[x]" or "[ ]" must appear. */
  | { kind: "checklist"; minBoxes?: number; requireChecked?: boolean }
  /** The pattern must match at least `minMatches` times. */
  | { kind: "regex"; pattern: string; flags?: string; minMatches?: number; hint?: string }
  /** The pattern must NOT match (placeholder text, filler, fabricated markers). */
  | { kind: "absence"; pattern: string; flags?: string; hint?: string }
  /** Speaker turns must use an uppercase label followed by a colon. */
  | { kind: "speakerLabels"; pattern?: string; minTurns?: number }
  /** No paragraph may exceed `max` words. */
  | { kind: "maxWordsPerParagraph"; max: number }
  /** The document must contain at least `characters` characters. */
  | { kind: "minLength"; characters: number };

export type OutputGuide = {
  title: string;
  description: string;
  speakerFormat: string;
  paragraphRules: string;
  punctuationRules: string;
  uncertaintyMarkers: string;
  editorialNotes?: string;
  checks: OutputGuideCheck[];
};

export type WorkflowTemplate = {
  id: string;
  name: string;
  description: string;
  category: string;
  isDefault?: boolean;
  ownerEmail?: string;
  formatRules: string;
  editRules: string;
  masterPrompt: string;
  outputGuide: OutputGuide;
  sampleInput?: string;
  sampleOutput?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkflowConfig = {
  name: string;
  description: string;
  templateId?: string;
  transcript: string;
  sourceFileName: string;
  formatRules: string;
  editRules: string;
  masterPrompt: string;
  outputGuide: OutputGuide;
  primaryModel: string;
  fallbackModels: string[];
  contextWindow: number;
  batchTokens: number;
  overlapTokens: number;
  maxOutputTokens: number;
  temperature: number;
};

export type SectionCheck = {
  section: number;
  /** Section name when the active template declares required headers. */
  label?: string;
  status: "pass" | "review";
  score: number;
  note: string;
  flags: string[];
};

export type TraceEvent = {
  id: string;
  stage: string;
  label: string;
  status: TraceStatus;
  batch?: number;
  total?: number;
  model?: string;
  duration?: number;
  message?: string;
  timestamp: string;
  demo?: boolean;
};

export type Progress = {
  stage: StageKey | "idle";
  stageIndex: number;
  batch: number;
  total: number;
};

export const MAX_ALTERNATIVES = 8;

export const PIPELINE: { key: StageKey; label: string; description: string }[] = [
  { key: "normalize", label: "Normalize", description: "Clean source signals" },
  { key: "format", label: "Format", description: "Apply structure" },
  { key: "edit", label: "Edit", description: "Polish with restraint" },
];

export const MODEL_OPTIONS = [
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3.5-lightning",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "google/gemma-4-26b-a4b-it:free",
  // DeepSeek (api.deepseek.com — set DEEPSEEK_API_KEY)
  "deepseek-flash",
  "deepseek-v4-pro",
  "deepseek-chat",
  "gemini-2.0-flash",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "meta/llama-3.3-70b-instruct",
  "mistralai/mixtral-8x7b-instruct",
];

export const DEFAULT_OUTPUT_GUIDE: OutputGuide = {
  title: "Standard Publication Layout & Speaker Format",
  description: "Standard editorial publication format for readable dialogue, chronological integrity, and clear speaker attribution.",
  speakerFormat: "UPPERCASE speaker label followed by a colon (e.g., 'SPEAKER 1:', 'INTERVIEWER:') on a new paragraph.",
  paragraphRules: "Natural paragraph breaks at topic shifts or conversational pauses (under 120 words per paragraph). No single giant blocks.",
  punctuationRules: "Ensure terminal punctuation on all sentences (. ! ?). Use em-dashes (—) for speech interruptions and ellipsis (...) for trailing thoughts.",
  uncertaintyMarkers: "Preserve [inaudible], [crosstalk], and [laughter] tags. Flag unresolved markers for human review.",
  editorialNotes: "Clean verbatim polish: remove meaningless filler words (um, uh) while preserving intent and voice.",
  checks: [
    {
      id: "check-speakers",
      label: "Speaker Labeling Consistency",
      description: "Verifies every speaker statement begins with a standardized uppercase label and colon.",
      rule: "Standardized uppercase label followed by colon (e.g. SPEAKER 1:).",
      category: "speaker",
      expectation: { kind: "speakerLabels", minTurns: 2 },
    },
    {
      id: "check-paragraphs",
      label: "Paragraph Rhythm & Length",
      description: "Checks that paragraphs are comfortably broken and avoid unbroken text blocks over 150 words.",
      rule: "Paragraphs under 120 words with double line break between speaker turns.",
      category: "structure",
      expectation: { kind: "maxWordsPerParagraph", max: 150 },
    },
    {
      id: "check-markers",
      label: "Uncertainty & Marker Audit",
      description: "Flags unresolved inaudible tags, crosstalk markers, or bracketed TODO notations.",
      rule: "Review all [inaudible], [crosstalk], or bracketed questions.",
      category: "verbatim",
    },
    {
      id: "check-punctuation",
      label: "Punctuation & Termination",
      description: "Ensures every sentence and paragraph ends with proper punctuation (. ! ?).",
      rule: "Terminal punctuation required at the end of each paragraph and statement.",
      category: "punctuation",
    },
    {
      id: "check-repetition",
      label: "Repetition & Stutter Filter",
      description: "Identifies accidental double words and speech stumbles without flattening intentional emphasis.",
      rule: "No unintentional consecutive repeated words.",
      category: "formatting",
      expectation: { kind: "absence", pattern: "\\b([A-Za-z]{2,})\\s+\\1\\b", hint: "consecutive duplicate words must be cleaned" },
    },
  ],
};

export const DEFAULT_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "tpl-standard-editorial",
    name: "Standard Editorial Dialogue",
    description: "Balanced clean-read transcription for interviews, podcasts, and articles. Polished grammar with authentic voice preserved.",
    category: "Editorial",
    isDefault: true,
    formatRules: `Use consistent uppercase speaker labels (e.g., SPEAKER 1:, INTERVIEWER:) followed by a colon and a space.
Break into natural paragraphs at conversational pauses or topic shifts (maximum 120 words per paragraph).
Keep chronological order. Do not insert synthetic headers or summarize content.`,
    editRules: `Improve grammar, punctuation, and syntax while preserving the speaker's natural tone and intent.
Remove meaningless fillers (um, uh, you know) unless they convey emphasis, hesitation, or meaning.
Preserve proper names, specialized terminology, numerical figures, dates, and uncertainty markers.`,
    masterPrompt: `You are a meticulous transcript editor working in controlled passes. Preserve meaning before style. Never invent a word that is not supported by the source, never merge speakers, and never silently resolve an uncertain phrase. Return only the requested transformation for the supplied batch.`,
    outputGuide: DEFAULT_OUTPUT_GUIDE,
  },
  {
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
          expectation: { kind: "speakerLabels", minTurns: 2 },
        },
        {
          id: "check-paragraphs",
          label: "Paragraph Pacing & Readability",
          description: "Ensures paragraphs remain under 120 words for optimal reading flow.",
          rule: "Paragraphs under 120 words with double line break between speaker turns.",
          category: "structure",
          expectation: { kind: "maxWordsPerParagraph", max: 120 },
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
          expectation: { kind: "absence", pattern: "\\b([A-Za-z]{2,})\\s+\\1\\b", hint: "consecutive duplicate words must be cleaned" },
        },
      ],
    },
    sampleInput: `SPEAKER 1: um so welcome everyone to today's direct response briefing uh we're looking at our recent campaign performance and the conversion rates were up about 14% over baseline... 

SPEAKER 2: yeah absolutely and when you look at the customer retention metrics that we tracked across August they exceeded our initial target by almost 200 basis points so the copy adjustments clearly resonated.`,
    sampleOutput: `SPEAKER 1: Welcome everyone to today's direct response briefing. We are looking at our recent campaign performance, and the conversion rates were up about 14% over baseline.

SPEAKER 2: Absolutely. When you look at the customer retention metrics that we tracked across August, they exceeded our initial target by almost 200 basis points, so the copy adjustments clearly resonated.`,
  },
  {
    id: "tpl-psychiatric-evaluation-master",
    name: "Psychiatric Diagnostic Evaluation Master",
    description: "Standardized psychiatric clinical documentation template. Converts clinical encounter notes and psychiatric evaluations into audit-ready documentation (Chief Complaint, HPI, Medications, Review of Systems, MSE, numbered Assessment, and Psychotherapy Add-on plan).",
    category: "Clinical & Medical",
    isDefault: false,
    formatRules: `Emit the document with these EXACT section headers, in this order, and add nothing between them:

CHIEF COMPLAINT: -
HISTORY OF PRESENT ILLNESS: -
CURRENT PSYCH MEDICATIONS: -
CURRENT NON-PSYCH MEDICATIONS: -
PAST PSYCH MEDICATIONS: -
PAST PSYCHIATRIC HISTORY: -
SUBSTANCE ABUSE HISTORY: -
TRAUMA HISTORY: -
SOCIAL HISTORY / EDUCATIONAL HISTORY: -
LEGAL HISTORY: -
FAMILY PSYCHIATRIC HISTORY: -
PAST MEDICAL HISTORY: -
DRUG ALLERGY: -
Objective:
Vital Signs:
REVIEW OF SYSTEMS:
Mental Status Exam:
Assessment:
Plan
Psychosocial/ Psychotherapeutic/ Behavioral Assessment (Therapy Add-on only):
RETURN TO CLINIC:

Rules for each part:
1. Keep every header verbatim, including the trailing colon and dash. Never rename, translate, reorder, merge, or omit a header.
2. HISTORY OF PRESENT ILLNESS is one continuous third-person narrative paragraph — no bullets.
3. CURRENT PSYCH MEDICATIONS, CURRENT NON-PSYCH MEDICATIONS, PAST PSYCH MEDICATIONS, and DRUG ALLERGY use "-" bullets, one item per line. Write "None" or "NKDA" when nothing is documented, and keep a documented adverse reaction attached to its drug.
4. REVIEW OF SYSTEMS uses one line per organ system: Constitutional, EYE, CARDIOVASCULAR, RESPIRATORY, GASTROINTESTINAL, Endocrine, MUSCULO-SKELETAL, NEUROLOGICAL.
5. Mental Status Exam uses "- " bullets in this order: Appearance, Behavior, Speech, Mood, Affect, Thought Process, Thought Content, Cognition, Insight, Judgment. Insight and Judgment read Good, Fair, or Poor.
6. Assessment is a numbered list (1., 2., 3., …) of concrete clinical decisions, highest priority first.
7. The Therapy Add-on block keeps every checkbox token as [x] or [ ] exactly as supplied, and never marks an item [x] unless the source supports it.
8. Vital Signs keeps the supplied values in place; leave a value blank rather than estimating it.
9. If the source does not document a required field, write [Not documented]. Never invent a value, date, dose, or diagnosis.`,
    editRules: `1. Transform raw psychiatric intake notes, conversational transcripts, or clinical summaries into a rigorous third-person medical record ("The client is a…", "The patient reports…", "He states…").
2. Never fabricate clinical content: no invented medications, doses, frequencies, laboratory values, dates, ages, diagnoses, or risk statements. Anything absent from the source becomes [Not documented].
3. Preserve every reported fact in substance — numbers, units, dates, ages, quantities — and keep quoted patient language intact (e.g. "I can't sleep").
4. Separate CURRENT PSYCH MEDICATIONS from CURRENT NON-PSYCH MEDICATIONS, and itemize every documented drug allergy under DRUG ALLERGY (or NKDA). Flag severe adverse reactions exactly as reported.
5. Attribute collateral history to its source (family, caregiver, case manager) inside HPI and the Therapy Add-on plan; never blend collateral statements into the patient's own voice.
6. Assessment: a sequentially numbered list (1, 2, 3…) covering medication continuity, monitoring, risk, family psychoeducation, fall prevention, and medical co-management.
7. Populate the Therapy Add-on checklist with precise brackets ([x] active, [ ] inactive) across Treatment Goals, Measures, Progress, Functional Status, and Prognosis, driven by the source.
8. Preserve uncertainty: keep [inaudible], [crosstalk], and unclear values marked rather than resolving them silently.`,
    masterPrompt: `You are an elite board-certified psychiatric documentation specialist. Convert the supplied encounter notes, clinical summary, or intake transcript into a standardized, audit-ready psychiatric diagnostic evaluation. Follow the required section headers, Review of Systems, Mental Status Exam, numbered Assessment, and Psychotherapy Add-on checklist exactly. Documentation integrity is non-negotiable: never invent, infer, or upgrade a clinical finding, and mark anything not documented as [Not documented]. Return only the clinical document — no commentary, no preamble, no explanation of these instructions.`,
    outputGuide: {
      title: "Psychiatric Diagnostic Evaluation Standard",
      description: "Clinical documentation standards for psychiatric evaluations: required section order, Review of Systems, Mental Status Examination, medication and allergy separation, and the psychotherapy add-on record.",
      speakerFormat: "Fixed uppercase clinical section headers (e.g. 'CHIEF COMPLAINT: -', 'HISTORY OF PRESENT ILLNESS: -', 'CURRENT PSYCH MEDICATIONS: -', 'Mental Status Exam:').",
      paragraphRules: "One continuous third-person narrative paragraph for HPI; bulleted lists for medications, allergies, and MSE fields; one line per organ system for the Review of Systems; numbered entries for Assessment; bracketed checklist for the Therapy Add-on.",
      punctuationRules: "Standard medical documentation punctuation. Keep the trailing colon-and-dash on each header exactly as written and bullet every list item with '-'.",
      uncertaintyMarkers: "Preserve [inaudible] and [crosstalk]. Report unknown dosages, strengths, or dates exactly as reported, and write [Not documented] for required fields the source never covers.",
      editorialNotes: "Clinical third-person voice. Strict separation of psychiatric vs non-psychiatric medications, explicit allergy documentation, and zero fabrication of clinical facts.",
      checks: [
        {
          id: "check-clinical-headers",
          label: "Clinical Section Headers Integrity",
          description: "Verifies every required psychiatric section is present, in the standard order.",
          rule: "Required section headers appear in order: CHIEF COMPLAINT, HISTORY OF PRESENT ILLNESS, CURRENT PSYCH MEDICATIONS, CURRENT NON-PSYCH MEDICATIONS, PAST PSYCH MEDICATIONS, PAST PSYCHIATRIC HISTORY, SUBSTANCE ABUSE HISTORY, TRAUMA HISTORY, SOCIAL HISTORY, LEGAL HISTORY, FAMILY PSYCHIATRIC HISTORY, PAST MEDICAL HISTORY, DRUG ALLERGY, Objective, Vital Signs, REVIEW OF SYSTEMS, Mental Status Exam, Assessment, Plan, RETURN TO CLINIC.",
          category: "formatting",
          expectation: {
            kind: "headers",
            headers: [
              "CHIEF COMPLAINT",
              "HISTORY OF PRESENT ILLNESS",
              "CURRENT PSYCH MEDICATIONS",
              "CURRENT NON-PSYCH MEDICATIONS",
              "PAST PSYCH MEDICATIONS",
              "PAST PSYCHIATRIC HISTORY",
              "SUBSTANCE ABUSE HISTORY",
              "TRAUMA HISTORY",
              "SOCIAL HISTORY",
              "LEGAL HISTORY",
              "FAMILY PSYCHIATRIC HISTORY",
              "PAST MEDICAL HISTORY",
              "DRUG ALLERGY",
              "Objective",
              "Vital Signs",
              "REVIEW OF SYSTEMS",
              "Mental Status Exam",
              "Assessment",
              "Plan",
              "RETURN TO CLINIC",
            ],
            // Abbreviations and EMR spellings seen in real encounter notes. The
            // contract still asks for the canonical headers; the guard accepts
            // the shorthand a clinician actually dictates.
            aliases: {
              "PAST PSYCHIATRIC HISTORY": ["PAST PSYCH HX", "PSYCHIATRIC HISTORY"],
              "SUBSTANCE ABUSE HISTORY": ["SUBSTANCE USE HISTORY", "SUBSTANCE HX"],
              "TRAUMA HISTORY": ["TRAUMA HX"],
              "SOCIAL HISTORY": ["SOCIAL HX"],
              "LEGAL HISTORY": ["LEGAL HX"],
              // "Family Hx" alone is ambiguous (family medical vs psychiatric), so
              // only the unambiguous psychiatric shorthand is accepted here.
              "FAMILY PSYCHIATRIC HISTORY": ["FAMILY PSYCH HX", "FAMILY PSYCHIATRIC HX"],
              "PAST MEDICAL HISTORY": ["MEDICAL HISTORY", "PAST MEDICAL HX"],
              "REVIEW OF SYSTEMS": ["ROS"],
              "Mental Status Exam": ["MSE"],
              // No alias for RETURN TO CLINIC: "follow up" is ordinary prose and
              // would make the disposition guard match a plan bullet instead.
            },
          },
        },
        {
          id: "check-meds-allergies",
          label: "Medication & Allergy Separation",
          description: "Ensures psych and non-psych medications are cleanly categorized and the allergy line is always documented.",
          rule: "Separate CURRENT PSYCH, CURRENT NON-PSYCH, and DRUG ALLERGY sections, with the allergy line present and bulleted (NKDA when nothing is documented).",
          category: "verbatim",
          expectation: { kind: "regex", pattern: "^DRUG ALLERGY:\\s*-", flags: "m", hint: "the DRUG ALLERGY line must stay in place, with NKDA when nothing is documented" },
        },
        {
          id: "check-ros-mse",
          label: "Review of Systems & MSE Completeness",
          description: "Validates the Review of Systems organ systems and a complete Mental Status Exam with rated insight and judgment.",
          rule: "Complete ROS and 10 MSE fields (Appearance, Behavior, Speech, Mood, Affect, Thought Process, Thought Content, Cognition, Insight, Judgment), with Insight and Judgment rated Good, Fair, or Poor.",
          category: "structure",
          expectation: { kind: "regex", pattern: "\\bInsight:\\s*(Good|Fair|Poor)", hint: "Insight and Judgment must be rated Good, Fair, or Poor" },
        },
        {
          id: "check-assessment-numbered",
          label: "Numbered Assessment List",
          description: "Ensures assessment items are sequentially numbered with concrete management steps.",
          rule: "Numbered list (1., 2., 3…) in the Assessment section, at least three prioritized items.",
          category: "structure",
          expectation: { kind: "numbered", minItems: 3 },
        },
        {
          id: "check-therapy-plan",
          label: "Psychotherapy Add-on Checklist",
          description: "Verifies the bracketed checkbox format for treatment goals, measures, functional status, and prognosis.",
          rule: "Checkbox tokens ([x] / [ ]) across Treatment Goals, Measures, Progress, Functional Status, and Prognosis, with at least one active item.",
          category: "punctuation",
          expectation: { kind: "checklist", minBoxes: 10, requireChecked: true },
        },
        {
          id: "check-return-to-clinic",
          label: "Return to Clinic & Disposition",
          description: "Confirms the document closes with an explicit follow-up interval and disposition.",
          rule: "RETURN TO CLINIC: with a Week(s) / Month(s) / PRN interval selected.",
          category: "structure",
          expectation: { kind: "regex", pattern: "RETURN TO CLINIC:", hint: "state the follow-up interval" },
        },
        {
          id: "check-no-placeholders",
          label: "Fabrication & Placeholder Guard",
          description: "Blocks unfilled template text, TODOs, and fabricated markers from shipping as a clinical record.",
          rule: "No [insert…], TBD, XXXX, or lorem ipsum placeholders; undocumented fields read [Not documented] instead.",
          category: "verbatim",
          expectation: { kind: "absence", pattern: "\\[\\s*(insert|todo|tbd|placeholder|your|unknown|missing)[^\\]]*\\]|\\bTBD\\b|lorem ipsum|\\bX{3,}\\b", hint: "unfilled template text must never ship as a clinical record" },
        },
      ],
    },
  },
  {
    id: "tpl-clean-verbatim",
    name: "Clean Verbatim & Legal Testimony",
    description: "Exact word preservation with speaker attributions for legal, compliance, and academic research.",
    category: "Legal & Compliance",
    formatRules: `Identify every speaker by explicit label: Q: / A: or WITNESS: / COUNSEL:.
Every speaker utterance starts on a fresh paragraph.
Preserve exact timestamps or sequence markers if present in the source.`,
    editRules: `Maintain high verbatim fidelity. Do NOT paraphrase or reorder sentences.
Remove only accidental stuttered words (e.g., 'I- I went') unless relevant to testimony.
Never omit words, names, legal terminology, or hesitation markers.`,
    masterPrompt: `You are a legal transcription specialist. Accuracy and verbatim fidelity are paramount. Do not summarize, extrapolate, or alter witness or speaker statements.`,
    outputGuide: {
      title: "Legal & Compliance Verbatim Standards",
      description: "Strict attribution and sentence integrity verification for official proceedings.",
      speakerFormat: "Formal speaker tags (e.g. 'MR. JOHNSON:', 'THE COURT:', 'Q:', 'A:').",
      paragraphRules: "One speaker turn per paragraph. No merging of separate exchanges.",
      punctuationRules: "Standard court-reporting punctuation. Quotation marks for cited testimony.",
      uncertaintyMarkers: "Strict notation: [inaudible hh:mm:ss], [crosstalk], [unintelligible].",
      editorialNotes: "Verbatim priority: preserve false starts that carry evidentiary value.",
      checks: [
        { id: "cv-speakers", label: "Speaker Turn Integrity", description: "Every speaker exchange has distinct attribution.", rule: "Explicit speaker tag for every utterance.", category: "speaker", expectation: { kind: "speakerLabels", pattern: "^[A-Z][A-Z0-9 .'-]{0,40}:\\s", minTurns: 2 } },
        { id: "cv-inaudible", label: "Timestamped Marker Audit", description: "Audit all inaudible and crosstalk timestamps.", rule: "Verify [inaudible hh:mm:ss] format.", category: "verbatim" },
        { id: "cv-fidelity", label: "Verbatim Preservation", description: "Zero paraphrasing or word substitution.", rule: "Retain exact testimony diction.", category: "verbatim", expectation: { kind: "absence", pattern: "\\b(in summary|to summarize|TL;DR|paraphrased)\\b", hint: "a verbatim record must never contain summary language" } },
        { id: "cv-punct", label: "Standard Punctuation", description: "Precise sentence boundaries.", rule: "Standard legal transcription punctuation.", category: "punctuation" },
      ],
    },
  },
  {
    id: "tpl-executive-briefing",
    name: "Executive Meeting & Minutes",
    description: "Structured business meeting transcript with clear speaker ownership, discussions, and decisions.",
    category: "Business",
    formatRules: `Label participants by Full Name or Role (e.g. SARAH (CEO):, DAVID (PRODUCT):).
Organize discussion blocks with clear paragraph spacing.
Retain chronological order of discussion items.`,
    editRules: `Tighten conversational sprawl while retaining every key decision, metric, deadline, and assigned action.
Clean up colloquial rambling while preserving the exact technical and business facts.`,
    masterPrompt: `You are an executive editor creating a pristine corporate transcript record. Focus on accuracy of commitments, figures, and technical points.`,
    outputGuide: {
      title: "Executive Transcript & Meeting Standards",
      description: "Crisp, professional record for corporate archives and stakeholder review.",
      speakerFormat: "NAME (ROLE): followed by statement.",
      paragraphRules: "Concise paragraph units grouped by discussion point.",
      punctuationRules: "Clean professional business punctuation.",
      uncertaintyMarkers: "Mark unclear terms with [phonetic: term] or [unclear].",
      editorialNotes: "Highlight clarity and quantitative accuracy.",
      checks: [
        { id: "exec-speakers", label: "Participant Attribution", description: "Names and roles accurately attached.", rule: "Consistent NAME (ROLE): format.", category: "speaker", expectation: { kind: "speakerLabels", minTurns: 2 } },
        { id: "exec-metrics", label: "Figures & Numbers Check", description: "Metrics, dates, and currency retained accurately.", rule: "No alteration of numbers or dates.", category: "verbatim", expectation: { kind: "regex", pattern: "\\d", minMatches: 1, hint: "at least one figure, date, or metric must survive the edit" } },
        { id: "exec-clarity", label: "Action Item Clarity", description: "Decisions and statements are unambiguous.", rule: "Concise business phrasing.", category: "structure", expectation: { kind: "maxWordsPerParagraph", max: 150 } },
      ],
    },
  },
  {
    id: "tpl-podcast-media",
    name: "Podcast & Media Broadcast",
    description: "Dynamic conversational flow designed for show notes, captions, and article syndication.",
    category: "Media & Audio",
    formatRules: `Use HOST: and GUEST: or presenter names.
Insert paragraph breaks at punchlines, topic transitions, and conversational beats.
Preserve conversational humor and tone.`,
    editRules: `Keep the conversational energy lively while eliminating awkward mid-sentence hesitations.
Ensure proper spelling of cultural references, brand names, and guest bios.`,
    masterPrompt: `You are a broadcast podcast editor. Maintain the entertaining flow and conversational warmth of the dialogue without clumsy speech artifacts.`,
    outputGuide: {
      title: "Broadcast & Audio Publication Guide",
      description: "Optimized for listener engagement, captions, and article publication.",
      speakerFormat: "HOST: and GUEST: in bold/caps on speaker change.",
      paragraphRules: "Brisk, digestible paragraphs (3-4 sentences max).",
      punctuationRules: "Expressive punctuation capturing conversational tone.",
      uncertaintyMarkers: "Note [laughter], [applause], [music] when audio context requires.",
      editorialNotes: "Maintain voice cadence and punchy delivery.",
      checks: [
        { id: "pod-speakers", label: "Host/Guest Continuity", description: "Clean speaker alternation.", rule: "Proper HOST / GUEST labeling.", category: "speaker", expectation: { kind: "speakerLabels", minTurns: 2 } },
        { id: "pod-rhythm", label: "Paragraph Flow", description: "Punchy breaks for easy skimming.", rule: "Max 3-4 sentences per paragraph.", category: "structure", expectation: { kind: "maxWordsPerParagraph", max: 110 } },
        { id: "pod-audio-cues", label: "Audio Cue Audit", description: "Validate atmospheric brackets [laughter], [music].", rule: "Preserve narrative sound tags.", category: "formatting", expectation: { kind: "absence", pattern: "\\b(inaudible|unintelligible)\\b(?!\\s*\\])", hint: "audio context must stay bracketed, never left as loose text" } },
      ],
    },
  },
];

export const DEFAULT_CONFIG: WorkflowConfig = {
  name: "Transcript edit",
  description: "",
  transcript: "",
  sourceFileName: "",
  formatRules: DEFAULT_TEMPLATES[0].formatRules,
  editRules: DEFAULT_TEMPLATES[0].editRules,
  masterPrompt: DEFAULT_TEMPLATES[0].masterPrompt,
  outputGuide: DEFAULT_OUTPUT_GUIDE,
  primaryModel: "nvidia/nemotron-3.5-lightning:free",
  fallbackModels: ["nvidia/nemotron-3.5-lightning", "nvidia/nemotron-3-ultra-550b-a55b", "deepseek-flash", "google/gemma-4-26b-a4b-it:free", "gemini-2.0-flash"],
  contextWindow: 32768,
  batchTokens: 2000,
  overlapTokens: 120,
  maxOutputTokens: 2000,
  temperature: 0.2,
};

export function makeId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function estimateTokens(text: string) {
  return Math.ceil((text || "").length / 4);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeOutputGuide(value: unknown): OutputGuide {
  if (!value || typeof value !== "object") return { ...DEFAULT_OUTPUT_GUIDE, checks: [...DEFAULT_OUTPUT_GUIDE.checks] };
  const candidate = value as Partial<OutputGuide>;
  const checks = Array.isArray(candidate.checks)
    ? candidate.checks
        .filter((c): c is OutputGuideCheck => Boolean(c && typeof c === "object" && typeof c.label === "string"))
        .map((c) => ({
          id: typeof c.id === "string" ? c.id : makeId(),
          label: typeof c.label === "string" ? c.label : "Quality Check",
          description: typeof c.description === "string" ? c.description : "",
          rule: typeof c.rule === "string" ? c.rule : "",
          category: (["speaker", "structure", "punctuation", "verbatim", "formatting"].includes(c.category as string)
            ? c.category
            : "structure") as OutputGuideCheck["category"],
          ...(normalizeExpectation(c.expectation) ? { expectation: normalizeExpectation(c.expectation) } : {}),
        }))
    : [...DEFAULT_OUTPUT_GUIDE.checks];

  return {
    title: typeof candidate.title === "string" && candidate.title.trim() ? candidate.title : DEFAULT_OUTPUT_GUIDE.title,
    description: typeof candidate.description === "string" ? candidate.description : DEFAULT_OUTPUT_GUIDE.description,
    speakerFormat: typeof candidate.speakerFormat === "string" && candidate.speakerFormat.trim() ? candidate.speakerFormat : DEFAULT_OUTPUT_GUIDE.speakerFormat,
    paragraphRules: typeof candidate.paragraphRules === "string" && candidate.paragraphRules.trim() ? candidate.paragraphRules : DEFAULT_OUTPUT_GUIDE.paragraphRules,
    punctuationRules: typeof candidate.punctuationRules === "string" && candidate.punctuationRules.trim() ? candidate.punctuationRules : DEFAULT_OUTPUT_GUIDE.punctuationRules,
    uncertaintyMarkers: typeof candidate.uncertaintyMarkers === "string" && candidate.uncertaintyMarkers.trim() ? candidate.uncertaintyMarkers : DEFAULT_OUTPUT_GUIDE.uncertaintyMarkers,
    editorialNotes: typeof candidate.editorialNotes === "string" ? candidate.editorialNotes : DEFAULT_OUTPUT_GUIDE.editorialNotes,
    checks: checks.length ? checks : [...DEFAULT_OUTPUT_GUIDE.checks],
  };
}

/** Validate a serialized expectation. Invalid or unchecked patterns are dropped. */
export function normalizeExpectation(value: unknown): OutputGuideExpectation | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<OutputGuideExpectation> & { kind?: string };
  const str = (input: unknown) => (typeof input === "string" ? input.trim() : "");
  const num = (input: unknown, fallback?: number) => {
    const parsed = Number(input);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  };
  const flags = (input: unknown) => {
    const clean = str(input).replace(/[^gimsuy]/g, "");
    return clean.includes("g") ? clean : `${clean}g`;
  };
  const validPattern = (pattern: string, rawFlags: string) => {
    try {
      new RegExp(pattern, rawFlags);
      return true;
    } catch {
      return false;
    }
  };

  switch (candidate.kind) {
    case "headers": {
      const headers = Array.isArray((candidate as { headers?: unknown }).headers)
        ? ((candidate as { headers: unknown[] }).headers)
            .filter((h): h is string => typeof h === "string" && h.trim().length > 0)
            .map((h) => h.trim().slice(0, 120))
            .slice(0, 60)
        : [];
      if (!headers.length) return undefined;
      // Real clinical documents abbreviate ("Trauma Hx", "ROS") and arrive from
      // EMR exports with SOAP prefixes. Aliases keep the ordered-header guard
      // honest without failing a correctly sectioned note.
      const rawAliases = (candidate as { aliases?: unknown }).aliases;
      const aliases: Record<string, string[]> = {};
      if (rawAliases && typeof rawAliases === "object" && !Array.isArray(rawAliases)) {
        for (const [key, value] of Object.entries(rawAliases as Record<string, unknown>)) {
          if (!Array.isArray(value)) continue;
          const canonical = headers.find((header) => header.toUpperCase() === key.trim().toUpperCase());
          if (!canonical) continue;
          const variants = value
            .filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
            .map((entry) => entry.trim().slice(0, 120))
            .slice(0, 8);
          if (variants.length) aliases[canonical] = variants;
        }
      }
      return {
        kind: "headers",
        headers,
        caseSensitive: Boolean((candidate as { caseSensitive?: unknown }).caseSensitive),
        ...(Object.keys(aliases).length ? { aliases } : {}),
      };
    }
    case "numbered":
      return { kind: "numbered", minItems: num((candidate as { minItems?: unknown }).minItems, 1) || 1 };
    case "checklist":
      return {
        kind: "checklist",
        minBoxes: num((candidate as { minBoxes?: unknown }).minBoxes, 1) || 1,
        requireChecked: Boolean((candidate as { requireChecked?: unknown }).requireChecked),
      };
    case "regex":
    case "absence": {
      const pattern = str((candidate as { pattern?: unknown }).pattern);
      if (!pattern) return undefined;
      const appliedFlags = flags((candidate as { flags?: unknown }).flags);
      if (!validPattern(pattern, appliedFlags)) return undefined;
      return candidate.kind === "regex"
        ? {
            kind: "regex",
            pattern,
            flags: appliedFlags,
            minMatches: num((candidate as { minMatches?: unknown }).minMatches, 1) || 1,
            hint: str((candidate as { hint?: unknown }).hint) || undefined,
          }
        : {
            kind: "absence",
            pattern,
            flags: appliedFlags,
            hint: str((candidate as { hint?: unknown }).hint) || undefined,
          };
    }
    case "speakerLabels":
      return {
        kind: "speakerLabels",
        pattern: str((candidate as { pattern?: unknown }).pattern) || undefined,
        minTurns: num((candidate as { minTurns?: unknown }).minTurns, 1) || 1,
      };
    case "maxWordsPerParagraph":
      return { kind: "maxWordsPerParagraph", max: num((candidate as { max?: unknown }).max, 150) || 150 };
    case "minLength":
      return { kind: "minLength", characters: num((candidate as { characters?: unknown }).characters, 1) || 1 };
    default:
      return undefined;
  }
}

/** Human-readable description of an expectation, used in prompts and the UI. */
export function describeExpectation(expectation: OutputGuideExpectation): string {
  switch (expectation.kind) {
    case "headers":
      return `Required section headers, in order: ${expectation.headers.join(" → ")}`;
    case "numbered":
      return `At least ${expectation.minItems} numbered line(s) (1., 2., 3.…)`;
    case "checklist":
      return `At least ${expectation.minBoxes} bracketed checkbox token(s) ([x] / [ ])${expectation.requireChecked ? ", with at least one checked" : ""}`;
    case "regex":
      return `Must match /${expectation.pattern}/ at least ${expectation.minMatches} time(s)${expectation.hint ? ` — ${expectation.hint}` : ""}`;
    case "absence":
      return `Must not match /${expectation.pattern}/${expectation.hint ? ` — ${expectation.hint}` : ""}`;
    case "speakerLabels":
      return `At least ${expectation.minTurns} speaker turn(s) labelled with an uppercase tag, colon, and space`;
    case "maxWordsPerParagraph":
      return `No paragraph above ${expectation.max} words`;
    case "minLength":
      return `Document of at least ${expectation.characters} character(s)`;
    default:
      return "";
  }
}

export function normalizeConfig(value: unknown): WorkflowConfig {
  if (!value || typeof value !== "object") {
    return {
      ...DEFAULT_CONFIG,
      outputGuide: { ...DEFAULT_OUTPUT_GUIDE, checks: [...DEFAULT_OUTPUT_GUIDE.checks] },
      fallbackModels: [...DEFAULT_CONFIG.fallbackModels],
    };
  }
  const candidate = value as Partial<WorkflowConfig>;
  const fallbackModels = Array.isArray(candidate.fallbackModels)
    ? candidate.fallbackModels.filter((model): model is string => typeof model === "string").slice(0, MAX_ALTERNATIVES)
    : [...DEFAULT_CONFIG.fallbackModels];
  return {
    ...DEFAULT_CONFIG,
    ...candidate,
    name: typeof candidate.name === "string" ? candidate.name : DEFAULT_CONFIG.name,
    description: typeof candidate.description === "string" ? candidate.description : DEFAULT_CONFIG.description,
    templateId: typeof candidate.templateId === "string" ? candidate.templateId : undefined,
    transcript: typeof candidate.transcript === "string" ? candidate.transcript : DEFAULT_CONFIG.transcript,
    sourceFileName: typeof candidate.sourceFileName === "string" ? candidate.sourceFileName : DEFAULT_CONFIG.sourceFileName,
    formatRules: typeof candidate.formatRules === "string" ? candidate.formatRules : DEFAULT_CONFIG.formatRules,
    editRules: typeof candidate.editRules === "string" ? candidate.editRules : DEFAULT_CONFIG.editRules,
    masterPrompt: typeof candidate.masterPrompt === "string" ? candidate.masterPrompt : DEFAULT_CONFIG.masterPrompt,
    outputGuide: normalizeOutputGuide(candidate.outputGuide),
    primaryModel: typeof candidate.primaryModel === "string" ? candidate.primaryModel : DEFAULT_CONFIG.primaryModel,
    fallbackModels,
    contextWindow: Number(candidate.contextWindow) || DEFAULT_CONFIG.contextWindow,
    batchTokens: Number(candidate.batchTokens) || DEFAULT_CONFIG.batchTokens,
    overlapTokens: Number(candidate.overlapTokens) || DEFAULT_CONFIG.overlapTokens,
    maxOutputTokens: Number(candidate.maxOutputTokens) || DEFAULT_CONFIG.maxOutputTokens,
    temperature: typeof candidate.temperature === "number" && Number.isFinite(candidate.temperature) ? clamp(candidate.temperature, 0, 1) : DEFAULT_CONFIG.temperature,
  };
}

function splitLongUnit(unit: string, maxChars: number) {
  if (unit.length <= maxChars) return [unit.trim()];
  const sentences = unit.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length < 2) {
    const words = unit.split(/\s+/);
    const pieces: string[] = [];
    let current = "";
    words.forEach((word) => {
      if (current && current.length + word.length + 1 > maxChars) {
        pieces.push(current);
        current = word;
      } else {
        current = current ? `${current} ${word}` : word;
      }
    });
    if (current) pieces.push(current);
    return pieces;
  }
  const pieces: string[] = [];
  let current = "";
  sentences.forEach((sentence) => {
    if (current && current.length + sentence.length + 1 > maxChars) {
      pieces.push(current);
      current = sentence;
    } else {
      current = current ? `${current} ${sentence}` : sentence;
    }
  });
  if (current) pieces.push(current);
  return pieces;
}

export function chunkTranscript(text: string, targetTokens: number) {
  const maxChars = Math.max(1600, Math.round(targetTokens * 4));
  const units = (text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((unit) => unit.trim())
    .filter(Boolean)
    .flatMap((unit) => splitLongUnit(unit, maxChars));
  const batches: string[] = [];
  let current = "";
  units.forEach((unit) => {
    if (current && current.length + unit.length + 2 > maxChars) {
      batches.push(current.trim());
      current = unit;
    } else {
      current = current ? `${current}\n\n${unit}` : unit;
    }
  });
  if (current.trim()) batches.push(current.trim());
  return batches.length ? batches : [];
}

/**
 * Cross-check the delivered output one section at a time.
 *
 * With no guide this walks blank-line paragraphs. With a guide that declares
 * required headers, it walks the template's own sections instead, so a clinical
 * evaluation is reviewed per section and any missing section is reported as a
 * guard failure rather than being silently absent from the report.
 */
export function sectionChecks(text: string, guide?: OutputGuide): SectionCheck[] {
  const clean = (text || "").trim();
  const headerExpectation = guide?.checks
    .map((check) => check.expectation)
    .find((expectation): expectation is Extract<OutputGuideExpectation, { kind: "headers" }> => expectation?.kind === "headers");

  if (headerExpectation && clean) {
    const headers = headerExpectation.headers;
    // Same tolerant, line-anchored matching the delivery audit uses, so the
    // per-section walk and the guard verdict can never disagree.
    const found = findHeaderPositions(clean, headerExpectation)
      .filter((entry) => entry.index >= 0)
      .sort((a, b) => a.index - b.index);

    if (found.length) {
      const checks: SectionCheck[] = found.map((entry, position) => {
        const next = found[position + 1];
        const body = clean.slice(entry.index, next ? next.index : undefined).trim();
        return buildSectionCheck(position + 1, body, entry.header, guide);
      });

      const missing = headerExpectation.headers.filter((header) => !found.some((entry) => entry.header === header));
      missing.forEach((header, index) => {
        checks.push({
          section: found.length + index + 1,
          label: header,
          status: "review",
          score: 0,
          note: `Required section "${header}" is missing from the delivered document.`,
          flags: [`Missing required section: ${header}`],
        });
      });

      return checks;
    }

    // Nothing matched: report every required section as missing instead of
    // pretending the output has clean paragraph structure.
    return headers.map((header, index) => ({
      section: index + 1,
      label: header,
      status: "review" as const,
      score: 0,
      note: `Required section "${header}" is missing from the delivered document.`,
      flags: [`Missing required section: ${header}`],
    }));
  }

  const sections = clean
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);
  return sections.map((section, index) => buildSectionCheck(index + 1, section, undefined, guide));
}

function buildSectionCheck(section: number, body: string, label: string | undefined, guide?: OutputGuide): SectionCheck {
  const trimmed = body.trim();
  const flags: string[] = [];

  if (!trimmed) flags.push(label ? `Section "${label}" is empty` : "Empty section");
  if (/\[(?:inaudible|crosstalk|unintelligible|unknown)\b[^\]]*\]|\bTODO\b|\?{3,}/i.test(trimmed)) {
    flags.push("Unresolved transcript marker");
  }
  if (/\b(\w+)\s+\1\b/i.test(trimmed)) flags.push("Repeated word");

  // Guide-declared guards that hold for any single section. Document-level
  // expectations (required headers, numbering, checklists) are audited once
  // against the whole output, not repeated on every section.
  for (const check of guide?.checks || []) {
    const expectation = check.expectation;
    if (!expectation || expectation.kind !== "absence" || !trimmed) continue;
    const result = evaluateExpectation(trimmed, expectation);
    if (result && !result.ok) flags.push(`${check.label}: ${result.message}`);
  }

  if (expectationFreeHeuristics(trimmed)) {
    if (trimmed.length > 300 && !/[.!?…]["')\]]?$/.test(trimmed)) flags.push("Long sentence needs a punctuation review");
    if (trimmed.length > 40 && !/[.!?…"')\]]$/.test(trimmed)) flags.push("Check ending punctuation");
  }

  const score = Math.max(0, 100 - flags.length * 22);
  return {
    section,
    ...(label ? { label } : {}),
    status: flags.length ? "review" : "pass",
    score,
    note: flags.length ? flags.join(" · ") : `${label ? `Section "${label}"` : "Structure"} and transcript markers look clean`,
    flags,
  };
}

/** Punctuation heuristics only apply to prose sections, not checklist/table ones. */
function expectationFreeHeuristics(section: string): boolean {
  if (!section) return false;
  const lines = section.split("\n").map((line) => line.trim()).filter(Boolean);
  const checklistLines = lines.filter((line) => /^[-*•]?\s*(\[[ xX]?\]|\(?[xX]?\)?)\s*/.test(line) || /\[\s*[xX]?\s*\]/.test(line));
  return checklistLines.length < Math.max(1, Math.ceil(lines.length * 0.6));
}

export type GuideAuditReport = {
  checkId: string;
  label: string;
  status: "pass" | "review";
  score: number;
  message: string;
  count: number;
  samples: string[];
  /** Present when the check ran a machine-checkable expectation. */
  expectation?: string;
};

export type GuideAuditResult = {
  overallScore: number;
  passedCount: number;
  reviewCount: number;
  reports: GuideAuditReport[];
};

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type HeaderExpectation = Extract<OutputGuideExpectation, { kind: "headers" }>;

/**
 * Line-anchored matcher for a required section header.
 *
 * Real documents prefix a header with whitespace, markdown emphasis, list
 * bullets, EMR SOAP letters ("O: REVIEW OF SYSTEMS:") or numbering, and real
 * clinicians abbreviate ("Trauma Hx", "ROS"). All of that is accepted; an
 * ordinary prose mention of the word is not, because the match must start a line.
 */
function findHeaderPositions(clean: string, expectation: HeaderExpectation): { header: string; index: number }[] {
  const flags = expectation.caseSensitive ? "m" : "im";
  return expectation.headers.map((header) => {
    const alternatives = [header, ...(expectation.aliases?.[header] || [])].map(escapeForRegex);
    // The header must not run straight into another word ("SOCIAL HISTORY/" and
    // "SOCIAL HISTORY: -" both count, "Planning" does not match PLAN).
    const pattern = `^[ \\t>*_#\\u2022\\-]*(?:(?:[SOAP])[.):]\\s*)?(?:\\d{1,2}\\s*[.)]\\s*)?(?:${alternatives.join("|")})(?![A-Za-z0-9])`;
    const regex = safeRegex(pattern, flags);
    if (!regex) return { header, index: -1 };
    const match = regex.exec(clean);
    return { header, index: match ? match.index : -1 };
  });
}

function safeRegex(pattern: string, flags = "g"): RegExp | null {
  try {
    return new RegExp(pattern, flags.includes("g") ? flags : `${flags}g`);
  } catch {
    return null;
  }
}

function trimSamples(values: string[], length = 100) {
  return Array.from(new Set(values.map((v) => (v.length > length ? `${v.slice(0, length)}…` : v)))).slice(0, 4);
}

/**
 * Evaluate a single machine-checkable expectation against the delivered output.
 * Returns null when the expectation cannot be evaluated (never silently passes).
 */
export function evaluateExpectation(
  text: string,
  expectation: OutputGuideExpectation
): { ok: boolean; message: string; count: number; samples: string[] } | null {
  const clean = text || "";
  const paragraphs = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

  switch (expectation.kind) {
    case "headers": {
      // Headers are matched at the start of a line (markdown emphasis and SOAP
      // prefixes tolerated) so an ordinary mention of "the plan" inside prose is
      // never mistaken for the PLAN section.
      const positions = findHeaderPositions(clean, expectation);
      const missing = positions.filter((entry) => entry.index === -1).map((entry) => entry.header);
      const present = positions.filter((entry) => entry.index >= 0);
      const outOfOrder = present
        .filter((entry, position) => position > 0 && entry.index < present[position - 1].index)
        .map((entry) => entry.header);
      if (missing.length) {
        return {
          ok: false,
          message: `Missing required section(s): ${missing.join(", ")}.`,
          count: missing.length,
          samples: missing,
        };
      }
      if (outOfOrder.length) {
        return {
          ok: false,
          message: `Section(s) out of the required order: ${outOfOrder.join(", ")}.`,
          count: outOfOrder.length,
          samples: outOfOrder,
        };
      }
      return { ok: true, message: `All ${expectation.headers.length} required sections are present in order.`, count: 0, samples: [] };
    }

    case "numbered": {
      const required = expectation.minItems || 1;
      const matches = clean.match(/^[ \t]*\d{1,2}[.)]\s+\S/gm) || [];
      if (matches.length < required) {
        return {
          ok: false,
          message: `Found ${matches.length} numbered item(s); the contract requires at least ${required}.`,
          count: matches.length,
          samples: [],
        };
      }
      return { ok: true, message: `${matches.length} numbered item(s) present.`, count: 0, samples: [] };
    }

    case "checklist": {
      const required = expectation.minBoxes || 1;
      const boxes = clean.match(/\[\s*[xX]?\s*\]/g) || [];
      const checked = clean.match(/\[\s*[xX]\s*\]/g) || [];
      if (boxes.length < required) {
        return {
          ok: false,
          message: `Found ${boxes.length} bracketed checkbox token(s); the contract requires at least ${required}.`,
          count: boxes.length,
          samples: [],
        };
      }
      if (expectation.requireChecked && checked.length === 0) {
        return {
          ok: false,
          message: "Checkbox tokens are present but none are marked [x], so no active item is recorded.",
          count: 0,
          samples: Array.from(new Set(boxes)).slice(0, 4),
        };
      }
      return { ok: true, message: `${boxes.length} checkbox token(s) present (${checked.length} checked).`, count: 0, samples: [] };
    }

    case "regex": {
      const regex = safeRegex(expectation.pattern, expectation.flags || "g");
      if (!regex) return null;
      const matches = clean.match(regex) || [];
      if (matches.length < (expectation.minMatches || 1)) {
        return {
          ok: false,
          message: `Pattern /${expectation.pattern}/ matched ${matches.length} time(s); ${expectation.minMatches || 1} required${expectation.hint ? ` (${expectation.hint})` : ""}.`,
          count: matches.length,
          samples: [],
        };
      }
      return { ok: true, message: `Pattern /${expectation.pattern}/ matched ${matches.length} time(s).`, count: 0, samples: [] };
    }

    case "absence": {
      const regex = safeRegex(expectation.pattern, expectation.flags || "g");
      if (!regex) return null;
      const matches = clean.match(regex) || [];
      if (matches.length) {
        return {
          ok: false,
          message: `${matches.length} forbidden token(s) found${expectation.hint ? ` (${expectation.hint})` : ""}.`,
          count: matches.length,
          samples: trimSamples(matches),
        };
      }
      return { ok: true, message: "No forbidden placeholder or unresolved token found.", count: 0, samples: [] };
    }

    case "speakerLabels": {
      const pattern = expectation.pattern ? safeRegex(expectation.pattern, "gm") : null;
      const turns = pattern
        ? (clean.match(pattern) || []).length
        : paragraphs.filter((p) => /^[A-Z0-9][A-Z0-9 _-]{0,30}:\s/.test(p)).length;
      const required = expectation.minTurns || 1;
      if (turns < required) {
        return {
          ok: false,
          message: `Found ${turns} properly labelled speaker turn(s); at least ${required} required.`,
          count: turns,
          samples: paragraphs.slice(0, 2).map((p) => p.slice(0, 80)),
        };
      }
      return { ok: true, message: `${turns} speaker turn(s) labelled consistently.`, count: 0, samples: [] };
    }

    case "maxWordsPerParagraph": {
      const long = paragraphs.filter((p) => p.split(/\s+/).filter(Boolean).length > expectation.max);
      if (long.length) {
        return {
          ok: false,
          message: `${long.length} paragraph(s) exceed ${expectation.max} words.`,
          count: long.length,
          samples: trimSamples(long),
        };
      }
      return { ok: true, message: `Every paragraph stays within ${expectation.max} words.`, count: 0, samples: [] };
    }

    case "minLength": {
      if (clean.length < expectation.characters) {
        return {
          ok: false,
          message: `Delivered ${clean.length} character(s); the contract requires at least ${expectation.characters}.`,
          count: clean.length,
          samples: [],
        };
      }
      return { ok: true, message: `${clean.length} characters delivered.`, count: 0, samples: [] };
    }

    default:
      return null;
  }
}

export function auditOutputAgainstGuide(text: string, guide: OutputGuide): GuideAuditResult {
  const clean = (text || "").trim();
  if (!clean) {
    return {
      overallScore: 0,
      passedCount: 0,
      reviewCount: guide.checks.length,
      reports: guide.checks.map((c) => ({
        checkId: c.id,
        label: c.label,
        status: "review",
        score: 0,
        message: "No output generated yet.",
        count: 0,
        samples: [],
      })),
    };
  }

  const paragraphs = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const reports: GuideAuditReport[] = [];

  for (const check of guide.checks) {
    // An explicit expectation is the contract: evaluate it exactly and skip the
    // category heuristic, so a template can never pass on a vague heuristic.
    if (check.expectation) {
      const result = evaluateExpectation(clean, check.expectation);
      if (result) {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: result.ok ? "pass" : "review",
          score: result.ok ? 100 : Math.max(30, 100 - result.count * 20),
          message: result.message,
          count: result.count,
          samples: result.samples,
          expectation: describeExpectation(check.expectation),
        });
        continue;
      }
    }

    if (check.category === "speaker") {
      // Check speaker labels
      const speakerPattern = /^([A-Z0-9 _-]{1,30})\s*:/;
      const unlabelled = paragraphs.filter((p) => !speakerPattern.test(p));
      const hasLabels = paragraphs.some((p) => speakerPattern.test(p));
      if (!hasLabels && paragraphs.length > 1) {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "review",
          score: 60,
          message: "No explicit speaker labels detected. Output guide recommends formatted speaker tags (e.g. SPEAKER:).",
          count: paragraphs.length,
          samples: paragraphs.slice(0, 2),
        });
      } else if (unlabelled.length > 0 && hasLabels) {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: unlabelled.length <= 2 ? "pass" : "review",
          score: Math.max(50, 100 - unlabelled.length * 15),
          message: `${unlabelled.length} paragraph(s) lack speaker tags. Check if they belong to preceding speaker.`,
          count: unlabelled.length,
          samples: unlabelled.slice(0, 2),
        });
      } else {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "pass",
          score: 100,
          message: "Speaker attribution format is consistent across dialogue paragraphs.",
          count: 0,
          samples: [],
        });
      }
    } else if (check.category === "structure") {
      // Check paragraph length
      const longParas = paragraphs.filter((p) => p.split(/\s+/).length > 150);
      if (longParas.length > 0) {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "review",
          score: Math.max(40, 100 - longParas.length * 20),
          message: `${longParas.length} paragraph(s) exceed 150 words. Guide suggests breaks under 120 words.`,
          count: longParas.length,
          samples: longParas.slice(0, 2).map((p) => p.slice(0, 100) + "…"),
        });
      } else {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "pass",
          score: 100,
          message: "Paragraph length and structure comply with reading rhythm specifications.",
          count: 0,
          samples: [],
        });
      }
    } else if (check.category === "verbatim") {
      // Check unresolved markers
      const markerMatches = clean.match(/\[(?:inaudible|crosstalk|unintelligible|unknown)[^\]]*\]|\bTODO\b|\?{3,}/gi) || [];
      if (markerMatches.length > 0) {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "review",
          score: Math.max(50, 100 - markerMatches.length * 15),
          message: `${markerMatches.length} uncertainty marker(s) found. Verify if human audio review is needed.`,
          count: markerMatches.length,
          samples: Array.from(new Set(markerMatches)).slice(0, 4),
        });
      } else {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "pass",
          score: 100,
          message: "No unresolved inaudible or TODO markers detected.",
          count: 0,
          samples: [],
        });
      }
    } else if (check.category === "punctuation") {
      // Check terminal punctuation
      const unpunctuated = paragraphs.filter((p) => !/[.!?…"')\]]$/.test(p));
      if (unpunctuated.length > 0) {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "review",
          score: Math.max(50, 100 - unpunctuated.length * 20),
          message: `${unpunctuated.length} paragraph(s) lack terminal punctuation (. ! ?).`,
          count: unpunctuated.length,
          samples: unpunctuated.slice(0, 2).map((p) => p.slice(-40)),
        });
      } else {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "pass",
          score: 100,
          message: "Terminal punctuation complies with editorial requirements.",
          count: 0,
          samples: [],
        });
      }
    } else {
      // Repeated words / stutters
      const repeats = clean.match(/\b([A-Za-z]+)\s+\1\b/gi) || [];
      if (repeats.length > 0) {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "review",
          score: Math.max(50, 100 - repeats.length * 18),
          message: `${repeats.length} consecutive duplicate word(s) identified.`,
          count: repeats.length,
          samples: Array.from(new Set(repeats)).slice(0, 3),
        });
      } else {
        reports.push({
          checkId: check.id,
          label: check.label,
          status: "pass",
          score: 100,
          message: "Clean repetition and stutter filter passed.",
          count: 0,
          samples: [],
        });
      }
    }
  }

  const passedCount = reports.filter((r) => r.status === "pass").length;
  const reviewCount = reports.filter((r) => r.status === "review").length;
  const totalScore = reports.reduce((acc, r) => acc + r.score, 0);
  const overallScore = Math.round(totalScore / Math.max(1, reports.length));

  return { overallScore, passedCount, reviewCount, reports };
}

export function slugify(value: string) {
  return (value || "transcript-edit").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "transcript-edit";
}

export function shortModel(value = "") {
  return value.replace(/^nvidia\//, "").replace(/^meta\//, "");
}
