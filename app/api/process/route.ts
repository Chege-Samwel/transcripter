import { NextRequest, NextResponse } from "next/server";
import { assertCanBookJob, getCurrentUser } from "../../../lib/account";
import { logError } from "../../../lib/errors";
import { capToWords, countWords } from "../../../lib/limits";
import { sleep } from "../../../lib/http";
import { getSystemModels } from "../../../lib/system-settings";

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

function getEndpoint() {
  const custom = process.env.NVIDIA_ENDPOINT?.trim() || process.env.AI_ENDPOINT?.trim();
  if (custom) return custom;
  const baseUrl = process.env.NVIDIA_BASE_URL?.trim();
  if (baseUrl) return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  return "https://integrate.api.nvidia.com/v1/chat/completions";
}

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

function isRetryableModelError(message: string) {
  if (/404|410|not found|deprecated|retired/i.test(message)) return false;
  return /abort|timeout|429|rate|503|502|504|network|fetch|ECONN|ETIMEDOUT|empty response/i.test(message);
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

function modelError(status: number, body: string, model?: string) {
  const tag = model ? `[${model}] ` : "";
  if (status === 401 || status === 403) return `${tag}NVIDIA authentication failed. Check your NVIDIA_API_KEY.`;
  if (status === 429) return `${tag}The model is rate limited. Falling back to alternative model.`;
  if (status === 413) return `${tag}The model rejected this batch because it is too large for the selected context window.`;
  if (status === 404) return `${tag}Model not found (404). This model ID is inactive or not available on the endpoint.`;
  if (status === 410) return `${tag}Model deprecated/retired (410). The endpoint no longer serves this model.`;
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } | string; detail?: string; message?: string };
    const errText = typeof parsed.error === "string" ? parsed.error : parsed.error?.message || parsed.detail || parsed.message;
    return errText ? `${tag}${errText}` : `${tag}Model request failed with status ${status}.`;
  } catch {
    return `${tag}Model request failed with status ${status}.`;
  }
}

async function callNvidia(
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  temperature: number,
  maxTokens: number,
) {
  const key = (process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY || "").trim();
  if (!key) throw new Error("NO_NVIDIA_KEY");

  const endpoint = getEndpoint();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: key.startsWith("Bearer ") ? key : `Bearer ${key}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature,
        top_p: 0.9,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(modelError(response.status, raw, model));
    const parsed = JSON.parse(raw) as {
      choices?: { message?: { content?: string | Array<{ text?: string }> } }[];
    };
    const content = parsed.choices?.[0]?.message?.content;
    const output = Array.isArray(content) ? content.map((part) => part.text || "").join("") : content;
    if (!output?.trim()) throw new Error("The model returned an empty response.");
    return output.trim();
  } finally {
    clearTimeout(timeout);
  }
}

async function callNvidiaWithRetry(
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  temperature: number,
  maxTokens: number,
  onRetry?: (attempt: number, reason: string) => void,
) {
  let lastError = "Model request failed.";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await callNvidia(model, messages, temperature, maxTokens);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unknown model error.";
      if (!isRetryableModelError(lastError) || attempt === 2) throw error;
      onRetry?.(attempt + 1, lastError);
      await sleep(500 * 2 ** attempt);
    }
  }
  throw new Error(lastError);
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

    const isAdmin = account.role === "admin";
    const systemModels = await getSystemModels();
    // System models configured by admin are platform-wide. Always execute with the authoritative system models.
    const primary = systemModels.primaryModel;
    const fallbacks = systemModels.fallbackModels;
    const models = Array.from(new Set([primary, ...fallbacks].filter(Boolean)));
    const rawTemperature = Number(body.temperature);
    const temperature = Math.min(1, Math.max(0, Number.isFinite(rawTemperature) ? rawTemperature : 0.2));
    const rawMaxTokens = Number(body.maxOutputTokens);
    const requestedMaxTokens = Math.min(16_000, Math.max(256, Number.isFinite(rawMaxTokens) ? rawMaxTokens : 4_000));
    // A provider's context window includes both the prompt and its reserved output
    // budget. Cap the output budget instead of letting a small context window fail
    // after the client has already planned a valid input batch.
    const availableOutputTokens = contextWindow - requestTokens - 256;
    if (availableOutputTokens < 256) {
      return NextResponse.json(
        {
          ok: false,
          error: `This batch needs ${requestTokens.toLocaleString()} input tokens and ${requestedMaxTokens.toLocaleString()} output tokens, above the safe ${contextWindow.toLocaleString()} token window. Reduce batch size, max output, or raise the context window.`,
          code: "CONTEXT_LIMIT",
          estimatedTokens: requestTokens,
          requestedOutputTokens: requestedMaxTokens,
          contextWindow,
        },
        { status: 413 },
      );
    }
    const maxTokens = Math.min(requestedMaxTokens, availableOutputTokens);

    if (!process.env.NVIDIA_API_KEY && !process.env.NVIDIA_NIM_API_KEY) {
      const output = demoTransform(stage, text, formatRules, editRules);
      const checks = stage === "crosscheck" ? [checkSection(text, body.batch?.index || 0)] : undefined;
      return NextResponse.json({
        ok: true,
        output,
        checks,
        ...(isAdmin ? { modelUsed: "Local safe preview", fallbackUsed: false } : {}),
        demo: true,
        kind,
        warning: isAdmin ? "No NVIDIA_API_KEY is configured, so this batch used the local preview transform." : undefined,
        estimatedTokens: requestTokens,
      });
    }

    const attempts: { model: string; error: string }[] = [];
    for (const model of models) {
      try {
        const output = await callNvidiaWithRetry(
          model,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          maxTokens,
        );
        const checks = stage === "crosscheck" ? [checkSection(text, body.batch?.index || 0)] : undefined;
        return NextResponse.json({
          ok: true,
          output,
          checks,
          ...(isAdmin ? {
            modelUsed: model,
            fallbackUsed: model !== primary,
            attempts,
          } : {}),
          estimatedTokens: requestTokens,
          kind,
          retryable: false,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown model error.";
        attempts.push({ model, error: message });
      }
    }

    const failure = attempts[attempts.length - 1]?.error || "Every configured model failed.";
    await logError({
      ownerEmail: account.email,
      jobId: body.jobId,
      stage,
      batch: body.batch?.index,
      code: "MODEL_FAILURE",
      message: failure,
      detail: { attempts: isAdmin ? attempts : undefined, kind },
    });
    return NextResponse.json(
      {
        ok: false,
        error: isAdmin ? failure : "Processing could not be completed at this time. Please try again.",
        ...(isAdmin ? { attempts } : {}),
        retryable: attempts.some((attempt) => isRetryableModelError(attempt.error)),
        code: "MODEL_FAILURE",
      },
      { status: 502 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not process this workflow request.";
    await logError({ ownerEmail: account.email, stage: "process", code: "PROCESS_ERROR", message });
    return NextResponse.json(
      { ok: false, error: message, retryable: isRetryableModelError(message), code: "PROCESS_ERROR" },
      { status: 500 },
    );
  }
}
