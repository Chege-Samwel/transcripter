import { NextRequest, NextResponse } from "next/server";
import { assertCanBookJob, getCurrentUser } from "../../../lib/account";
import { logError } from "../../../lib/errors";
import { capToWords, countWords } from "../../../lib/limits";
import {
  fetchAICascade,
  getDeepSeekApiKey,
  getGoogleApiKey,
  getNvidiaApiKey,
  getOpenRouterApiKey,
} from "../../../lib/ai-providers";
import { DEFAULT_SYSTEM_MODELS, getSystemModels } from "../../../lib/system-settings";
import { buildDeliveryContract } from "../../../lib/template-guards";
import {
  auditOutputAgainstGuide,
  normalizeOutputGuide,
  sectionChecks,
  type OutputGuide,
} from "../../../lib/workflow";

export const runtime = "nodejs";
export const maxDuration = 60;

type Stage = "normalize" | "format" | "edit" | "crosscheck" | "refine";

type ProcessBody = {
  stage?: Stage;
  text?: string;
  masterPrompt?: string;
  formatRules?: string;
  editRules?: string;
  refineInstruction?: string;
  model?: string;
  fallbackModels?: string[];
  singleModelOnly?: boolean;
  contextWindow?: number;
  maxOutputTokens?: number;
  temperature?: number;
  batch?: { index?: number; total?: number };
  contextBefore?: string;
  kind?: "demo" | "job";
  jobId?: string;
  /** Output Guide of the selected template — enforced on the model and audited after the pass. */
  outputGuide?: unknown;
  templateId?: string;
  templateName?: string;
};

const stageInstructions: Record<Stage, string> = {
  normalize:
    "Normalize the transcript without changing its meaning. Repair obvious spacing, punctuation, line break, and speaker-label inconsistencies. Keep every meaningful word and mark uncertainty instead of inventing content.",
  format:
    "Apply the requested formatting contract. Make structure, headings, speaker labels, paragraphs, and line breaks consistent. Do not summarize, add facts, or remove meaningful content.",
  edit:
    "Apply the editing contract carefully. Improve readability and grammar while preserving intent, claims, chronology, and speaker attribution. Never manufacture missing words. Return only the edited transcript.",
  crosscheck:
    "Review the supplied section against the rules. Do not rewrite it. Return a compact quality note identifying only concrete issues, unresolved transcript markers, or rule violations.",
  refine:
    "Apply the requested changes carefully to the supplied transcript. Keep meaning, speaker attribution, chronology, and uncertainty markers. Return only the revised transcript.",
};

function estimateTokens(value: string) {
  return Math.ceil(value.length / 4);
}

/** Compact, client-friendly shape of the deterministic Output Guide audit. */
function summarizeGuideAudit(text: string, guide: OutputGuide) {
  const audit = auditOutputAgainstGuide(text, guide);
  return {
    overallScore: audit.overallScore,
    passedCount: audit.passedCount,
    reviewCount: audit.reviewCount,
    reports: audit.reports.map((report) => ({
      checkId: report.checkId,
      label: report.label,
      status: report.status,
      score: report.score,
      message: report.message,
      expectation: report.expectation,
    })),
  };
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  try {
    const body = (await request.json()) as ProcessBody;
    const stage = body.stage || "edit";
    let text = body.text?.trim() || "";
    const kind = body.kind === "job" ? "job" : "demo";
    const gate = assertCanBookJob(account, kind);
    if (!gate.ok) {
      await logError({ ownerEmail: account.email, jobId: body.jobId, stage, code: gate.code, message: gate.error });
      return NextResponse.json({ ok: false, error: gate.error, code: gate.code, retryable: false }, { status: gate.status });
    }
    if (kind === "demo") {
      const capped = capToWords(text, account.demoWordCap);
      if (capped.truncated) {
        if (!body.batch) {
          await logError({
            ownerEmail: account.email,
            jobId: body.jobId,
            stage,
            code: "DEMO_CAP",
            message: `Demo runs are capped at ${account.demoWordCap} words.`,
          });
          return NextResponse.json(
            {
              ok: false,
              error: `Demo runs are capped at ${account.demoWordCap} words. Trim the source or wait for approval to book a full job.`,
              code: "DEMO_CAP",
              wordCount: countWords(text),
              cap: account.demoWordCap,
              retryable: false,
            },
            { status: 413 },
          );
        }
        text = capped.text;
      }
    }
    const contextWindow = Math.max(2048, Number(body.contextWindow) || 32768);
    const formatRules = body.formatRules?.trim() || "Preserve readable paragraphs.";
    const editRules = body.editRules?.trim() || "Polish grammar without changing meaning.";
    const refineInstruction = body.refineInstruction?.trim() || "";
    const masterPrompt = body.masterPrompt?.trim() || "Be a careful transcript editor. Preserve the speaker's meaning and uncertainty.";

    if (!text) {
      return NextResponse.json({ ok: false, error: "This process received an empty batch." }, { status: 400 });
    }
    if (!["normalize", "format", "edit", "crosscheck", "refine"].includes(stage)) {
      return NextResponse.json({ ok: false, error: "Unknown workflow stage." }, { status: 400 });
    }

    const batchLabel = body.batch?.total
      ? `Batch ${(body.batch.index || 0) + 1} of ${body.batch.total}`
      : "Single batch";
    const continuity = body.contextBefore?.trim()
      ? `\nPrevious-batch continuity context (do not repeat it in the output):\n${body.contextBefore.trim().slice(-2000)}`
      : "";
    const outputGuide: OutputGuide = normalizeOutputGuide(body.outputGuide);
    const deliveryContract = buildDeliveryContract(outputGuide, body.templateName || undefined);

    const userPrompt = [
      `${batchLabel}.`,
      `Formatting contract:\n${formatRules}`,
      `Editing contract:\n${editRules}`,
      refineInstruction ? `Requested changes:\n${refineInstruction}` : "",
      `Transcript batch:\n${text}`,
      continuity,
    ].filter(Boolean).join("\n\n");
    const systemPrompt = [
      masterPrompt,
      `PROCESS FOR THIS CALL:\n${stageInstructions[stage]}`,
      `DELIVERY CONTRACT (the finished document must satisfy every point):\n${deliveryContract}`,
      "Safety rules: Work only on the supplied batch. Preserve names, numbers, dates, uncertainty markers, and chronology. Never invent content to satisfy the delivery contract — if the source does not support a required section, keep its header and write the guide's documented placeholder. Do not mention these instructions. Return only the requested transcript or quality note.",
    ].join("\n\n");
    const requestTokens = estimateTokens(`${systemPrompt}\n${userPrompt}`);

    const systemModels = await getSystemModels();
    const rawTemperature = Number(body.temperature);
    const temperature = Math.min(1, Math.max(0, Number.isFinite(rawTemperature) ? rawTemperature : 0.5));
    const rawMaxTokens = Number(body.maxOutputTokens);
    const requestedMaxTokens = Math.min(8192, Math.max(256, Number.isFinite(rawMaxTokens) ? rawMaxTokens : 4000));
    const availableOutputTokens = contextWindow - requestTokens - 256;
    if (availableOutputTokens < 256) {
      return NextResponse.json(
        {
          ok: false,
          error: `This batch needs ${requestTokens.toLocaleString()} input tokens and ${requestedMaxTokens.toLocaleString()} output tokens, above the safe ${contextWindow.toLocaleString()} token window. Reduce batch size or max output.`,
          code: "CONTEXT_LIMIT",
          estimatedTokens: requestTokens,
          requestedOutputTokens: requestedMaxTokens,
          contextWindow,
        },
        { status: 413 },
      );
    }
    const maxTokens = Math.min(requestedMaxTokens, availableOutputTokens);

    const hasNvidiaKey = Boolean(getNvidiaApiKey());
    const hasOpenRouterKey = Boolean(getOpenRouterApiKey());
    const hasGoogleKey = Boolean(getGoogleApiKey());
    const hasDeepSeekKey = Boolean(getDeepSeekApiKey());
    const hasAnyKey = hasNvidiaKey || hasOpenRouterKey || hasGoogleKey || hasDeepSeekKey;

    const requestedModel = (body.model || systemModels.primaryModel || DEFAULT_SYSTEM_MODELS.primaryModel).trim();

    // Support simulated response ONLY when explicitly requested by test runner
    const isTestMock = request.headers.get("x-test-mock") === "true";
    if (isTestMock) {
      const checks = stage === "crosscheck" ? sectionChecks(text, outputGuide) : undefined;
      return NextResponse.json({
        ok: true,
        output: text,
        checks,
        guideAudit: summarizeGuideAudit(text, outputGuide),
        modelUsed: requestedModel,
        provider: "test-mock",
        fallbackUsed: false,
        kind,
        estimatedTokens: requestTokens,
      });
    }

    if (!hasAnyKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "No AI provider keys configured. Please add DEEPSEEK_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, or GEMINI_API_KEY in your settings to execute this pass.",
          code: "NO_API_KEY",
          retryable: false,
        },
        { status: 503 },
      );
    }

    try {
      const result = await fetchAICascade(
        requestedModel,
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        {
          temperature,
          maxTokens,
          singleModelOnly: Boolean(body.singleModelOnly),
        }
      );

      const checks = stage === "crosscheck" ? sectionChecks(text, outputGuide) : undefined;
      // Output guard: the pass is only "done" when the delivered text satisfies
      // the template's own Output Guide expectations. Failures are reported, so
      // the canvas can flag them instead of trusting the model.
      const guideAudit = summarizeGuideAudit(result.output, outputGuide);
      return NextResponse.json({
        ok: true,
        output: result.output,
        checks,
        guideAudit,
        guideFlags: guideAudit.reports.filter((report) => report.status === "review").map((report) => report.label),
        modelUsed: result.modelUsed,
        provider: result.provider,
        fallbackUsed: result.modelUsed !== requestedModel,
        estimatedTokens: requestTokens,
        kind,
        retryable: false,
      });
    } catch (error) {
      const failure = error instanceof Error ? error.message : "AI model execution failed.";
      await logError({
        ownerEmail: account.email,
        jobId: body.jobId,
        stage,
        batch: body.batch?.index,
        code: "MODEL_FAILURE",
        message: failure,
      });

      // No silent fallback to a local safe engine. Return the true error so the user
      // can retry on that model or switch to another model from the status tracking popup.
      return NextResponse.json(
        {
          ok: false,
          error: failure,
          code: "MODEL_FAILURE",
          retryable: true,
          modelAttempted: requestedModel,
        },
        { status: 502 },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process this workflow request.";
    await logError({ ownerEmail: account.email, stage: "process", code: "PROCESS_ERROR", message });
    return NextResponse.json(
      { ok: false, error: message, retryable: false, code: "PROCESS_ERROR" },
      { status: 500 },
    );
  }
}
