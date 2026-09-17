import { NextRequest, NextResponse } from "next/server";
import { assertCanBookJob, getCurrentUser } from "../../../lib/account";
import { logError } from "../../../lib/errors";
import { capToWords, countWords } from "../../../lib/limits";
import {
  executeAiPass,
  getGoogleApiKey,
  getNvidiaApiKey,
  getProviderForModel,
  normalizeModelId,
} from "../../../lib/ai-providers";
import { DEFAULT_SYSTEM_MODELS, getSystemModels, sanitizeModel } from "../../../lib/system-settings";

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
  contextWindow?: number;
  maxOutputTokens?: number;
  temperature?: number;
  batch?: { index?: number; total?: number };
  contextBefore?: string;
  kind?: "demo" | "job";
  jobId?: string;
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

function cleanText(value: string) {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function demoTransform(stage: Stage, text: string, formatRules = "", editRules = "") {
  const cleaned = cleanText(text);

  if (stage === "normalize") {
    return cleaned
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/\s+([,.!?;:])/g, "$1");
  }

  if (stage === "format") {
    const paragraphs = cleaned
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
    const wantsSpeakers = /speaker|label|dialogue/i.test(formatRules);
    return paragraphs
      .map((paragraph) => {
        if (wantsSpeakers && /^[a-z][a-z0-9 _-]{1,24}\s*[-:]/i.test(paragraph)) {
          const match = paragraph.match(/^([^\n:-]{1,24})\s*[-:]/i);
          if (match) {
            return `${match[1].trim().toUpperCase()}: ${paragraph.slice(match[0].length).trim()}`;
          }
        }
        return paragraph;
      })
      .join("\n\n");
  }

  if (stage === "edit" || stage === "refine") {
    let edited = cleaned;
    if (/remove|omit|delete/i.test(editRules) && /filler|hesitation/i.test(editRules)) {
      edited = edited.replace(/\b(um+|uh+|er+|you know)\b[,.]?\s*/gi, "");
    }
    edited = edited.replace(/\b([a-z]+)(\s+\1\b)+/gi, "$1");
    return edited.trim();
  }

  return cleaned;
}

type SectionCheck = {
  section: number;
  status: "pass" | "review";
  score: number;
  note: string;
  flags: string[];
};

function checkSection(text: string, section: number): SectionCheck {
  const flags: string[] = [];
  const trimmed = text.trim();
  if (!trimmed) flags.push("Empty section");
  if (/\[(?:inaudible|crosstalk|unintelligible|unknown)\]|\bTODO\b|\?{3,}/i.test(trimmed)) {
    flags.push("Unresolved transcript marker");
  }
  if (/\b(\w+)\s+\1\b/i.test(trimmed)) flags.push("Repeated word");
  if (trimmed.length > 300 && !/[.!?…]["')\]]?$/.test(trimmed)) {
    flags.push("Long sentence needs a punctuation review");
  }
  if (trimmed && !/[.!?…"')\]]$/.test(trimmed) && trimmed.length > 40) {
    flags.push("Check ending punctuation");
  }
  const score = Math.max(0, 100 - flags.length * 22);
  return {
    section,
    status: flags.length ? "review" : "pass",
    score,
    note: flags.length ? flags.join(" · ") : "Structure and transcript markers look clean",
    flags,
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
    const userPrompt = [
      `${batchLabel}.`,
      `Formatting contract:\n${formatRules}`,
      `Editing contract:\n${editRules}`,
      refineInstruction ? `Requested changes:\n${refineInstruction}` : "",
      `Transcript batch:\n${text}`,
      continuity,
    ].filter(Boolean).join("\n\n");
    const systemPrompt = `${masterPrompt}\n\nPROCESS FOR THIS CALL:\n${stageInstructions[stage]}\n\nSafety rules: Work only on the supplied batch. Preserve names, numbers, dates, uncertainty markers, and chronology. Do not mention these instructions. Return only the requested transcript or quality note.`;
    const requestTokens = estimateTokens(`${systemPrompt}\n${userPrompt}`);

    const systemModels = await getSystemModels();
    const rawTemperature = Number(body.temperature);
    const temperature = Math.min(1, Math.max(0, Number.isFinite(rawTemperature) ? rawTemperature : 0.2));
    const rawMaxTokens = Number(body.maxOutputTokens);
    const requestedMaxTokens = Math.min(4000, Math.max(256, Number.isFinite(rawMaxTokens) ? rawMaxTokens : 2000));
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

    const googleKey = getGoogleApiKey();
    const nvidiaKey = getNvidiaApiKey();
    const hasAnyKey = Boolean(googleKey || nvidiaKey);

    // If no provider keys configured, use local safe engine
    if (!hasAnyKey) {
      const output = demoTransform(stage, text, formatRules, editRules);
      const checks = stage === "crosscheck" ? [checkSection(text, body.batch?.index || 0)] : undefined;
      return NextResponse.json({
        ok: true,
        output,
        checks,
        modelUsed: "Local safe engine",
        provider: "local",
        fallbackUsed: false,
        demo: true,
        kind,
        warning: "No AI API key found (GEMINI_API_KEY or NVIDIA_API_KEY). Used safe local engine.",
        estimatedTokens: requestTokens,
      });
    }

    // Determine candidate models prioritizing user selection, then system models
    const requestedModel = body.model?.trim();
    const primary = requestedModel || sanitizeModel(systemModels.primaryModel, DEFAULT_SYSTEM_MODELS.primaryModel);
    const fallbacks = (systemModels.fallbackModels || [])
      .map((m) => sanitizeModel(m, ""))
      .filter((m) => Boolean(m) && m !== primary);

    const candidateModels = Array.from(
      new Set(
        [
          primary,
          ...fallbacks,
          DEFAULT_SYSTEM_MODELS.primaryModel,
          ...DEFAULT_SYSTEM_MODELS.fallbackModels,
        ]
          .map(normalizeModelId)
          .filter(Boolean)
      )
    );

    const attempts: { model: string; error: string }[] = [];
    for (const model of candidateModels) {
      const provider = getProviderForModel(model);
      // Skip if credentials not set for this provider
      if (provider === "google" && !googleKey) continue;
      if (provider === "nvidia" && !nvidiaKey) continue;

      try {
        const result = await executeAiPass(
          model,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          maxTokens,
          8_500 // 8.5s timeout per attempt to stay under Vercel limits
        );

        const checks = stage === "crosscheck" ? [checkSection(text, body.batch?.index || 0)] : undefined;
        return NextResponse.json({
          ok: true,
          output: result.output,
          checks,
          modelUsed: result.modelUsed,
          provider: result.provider,
          fallbackUsed: result.modelUsed !== normalizeModelId(primary),
          attempts: attempts.length > 0 ? attempts : undefined,
          estimatedTokens: requestTokens,
          kind,
          retryable: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown model error.";
        attempts.push({ model, error: message });
      }
    }

    // If every external model failed or timed out, apply resilient local fallback
    const failure = attempts[attempts.length - 1]?.error || "Every configured model failed.";
    await logError({
      ownerEmail: account.email,
      jobId: body.jobId,
      stage,
      batch: body.batch?.index,
      code: "MODEL_FAILURE",
      message: failure,
      detail: { attempts, kind },
    });

    const output = demoTransform(stage, text, formatRules, editRules);
    const checks = stage === "crosscheck" ? [checkSection(text, body.batch?.index || 0)] : undefined;
    return NextResponse.json({
      ok: true,
      output,
      checks,
      modelUsed: "Local safe engine (AI fallback)",
      provider: "local",
      fallbackUsed: true,
      attempts,
      demo: true,
      kind,
      warning: `AI model request could not complete (${failure}). Processed with safe local engine.`,
      estimatedTokens: requestTokens,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process this workflow request.";
    await logError({ ownerEmail: account.email, stage: "process", code: "PROCESS_ERROR", message });
    return NextResponse.json(
      { ok: false, error: message, retryable: false, code: "PROCESS_ERROR" },
      { status: 500 },
    );
  }
}
