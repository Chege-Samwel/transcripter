export type StageKey = "normalize" | "format" | "edit";
export type TraceStatus = "queued" | "running" | "success" | "error";

export type OutputGuideCheck = {
  id: string;
  label: string;
  description: string;
  rule: string;
  category: "speaker" | "structure" | "punctuation" | "verbatim" | "formatting";
};

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
    },
    {
      id: "check-paragraphs",
      label: "Paragraph Rhythm & Length",
      description: "Checks that paragraphs are comfortably broken and avoid unbroken text blocks over 150 words.",
      rule: "Paragraphs under 120 words with double line break between speaker turns.",
      category: "structure",
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
        { id: "cv-speakers", label: "Speaker Turn Integrity", description: "Every speaker exchange has distinct attribution.", rule: "Explicit speaker tag for every utterance.", category: "speaker" },
        { id: "cv-inaudible", label: "Timestamped Marker Audit", description: "Audit all inaudible and crosstalk timestamps.", rule: "Verify [inaudible hh:mm:ss] format.", category: "verbatim" },
        { id: "cv-fidelity", label: "Verbatim Preservation", description: "Zero paraphrasing or word substitution.", rule: "Retain exact testimony diction.", category: "verbatim" },
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
        { id: "exec-speakers", label: "Participant Attribution", description: "Names and roles accurately attached.", rule: "Consistent NAME (ROLE): format.", category: "speaker" },
        { id: "exec-metrics", label: "Figures & Numbers Check", description: "Metrics, dates, and currency retained accurately.", rule: "No alteration of numbers or dates.", category: "verbatim" },
        { id: "exec-clarity", label: "Action Item Clarity", description: "Decisions and statements are unambiguous.", rule: "Concise business phrasing.", category: "structure" },
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
        { id: "pod-speakers", label: "Host/Guest Continuity", description: "Clean speaker alternation.", rule: "Proper HOST / GUEST labeling.", category: "speaker" },
        { id: "pod-rhythm", label: "Paragraph Flow", description: "Punchy breaks for easy skimming.", rule: "Max 3-4 sentences per paragraph.", category: "structure" },
        { id: "pod-audio-cues", label: "Audio Cue Audit", description: "Validate atmospheric brackets [laughter], [music].", rule: "Preserve narrative sound tags.", category: "formatting" },
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
  fallbackModels: ["nvidia/nemotron-3.5-lightning", "nvidia/nemotron-3-ultra-550b-a55b", "google/gemma-4-26b-a4b-it:free", "gemini-2.0-flash"],
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

export function sectionChecks(text: string): SectionCheck[] {
  const sections = (text || "")
    .split(/\n\s*\n/)
    .map((section) => section.trim())
    .filter(Boolean);
  return sections.map((section, index) => {
    const flags: string[] = [];
    if (/\[(?:inaudible|crosstalk|unintelligible|unknown)\]|\bTODO\b|\?{3,}/i.test(section)) flags.push("Unresolved transcript marker");
    if (/\b(\w+)\s+\1\b/i.test(section)) flags.push("Repeated word");
    if (section.length > 300 && !/[.!?…]["')\]]?$/.test(section)) flags.push("Long sentence needs a punctuation review");
    if (section.length > 40 && !/[.!?…"')\]]$/.test(section)) flags.push("Check ending punctuation");
    return {
      section: index + 1,
      status: flags.length ? "review" : "pass",
      score: Math.max(0, 100 - flags.length * 22),
      note: flags.length ? flags.join(" · ") : "Structure and transcript markers look clean",
      flags,
    };
  });
}

export type GuideAuditReport = {
  checkId: string;
  label: string;
  status: "pass" | "review";
  score: number;
  message: string;
  count: number;
  samples: string[];
};

export function auditOutputAgainstGuide(text: string, guide: OutputGuide): {
  overallScore: number;
  passedCount: number;
  reviewCount: number;
  reports: GuideAuditReport[];
} {
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
