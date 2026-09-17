import { NextRequest, NextResponse } from "next/server";
import { assertCanBookJob, getCurrentUser } from "../../../lib/account";
import { logError } from "../../../lib/errors";
import { capToWords, countWords } from "../../../lib/limits";
import { sleep } from "../../../lib/http";
import { attemptTimeout, createDeadline } from "../../../lib/budget";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Time budget for the model fan-out.
 *
 * Before this, one attempt could wait 50s, be retried 3 times with backoff
 * (151.5s), and that was repeated for every model in the chain — 454.5s with
 * the default 3-model chain and up to 1363.5s with a full 9-model chain. Any
 * run past `maxDuration` is killed by Vercel, which answers the browser with a
 * bare 504 and no body, so the UI could not say why the pass stopped.
 *
 * The budget below is derived from `maxDuration`, so raising the project's
 * function limit only requires changing that one number.
 */
const PLATFORM_BUDGET_MS = maxDuration * 1000;
/** Room for the final response, error logging, and the platform's own overhead. */
const RESERVED_MS = 6_000;
/** An attempt with less time than this cannot plausibly complete a completion. */
const MIN_ATTEMPT_MS = 4_000;
/** Ceiling for a single call, so a huge budget does not mean one huge wait. */
const PER_ATTEMPT_CAP_MS = 20_000;
/** Retries per model, inside the shared budget. */
const MAX_ATTEMPTS_PER_MODEL = 2;
/** Backoff before a retry, ms, by attempt number. */
const RETRY_BACKOFF_MS = [400, 900];

/** Thrown when the invocation budget runs out; never worth starting another model. */
class BudgetExhausted extends Error {
  readonly code = "TIMEOUT";
  constructor(message: string) {
    super(message);
    this.name = "BudgetExhausted";
  }
}

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

const DEFAULT_NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

/** Overridable so tests and self-hosted gateways can point elsewhere. */
function nvidiaEndpoint() {
  return process.env.NVIDIA_ENDPOINT?.trim() || DEFAULT_NVIDIA_ENDPOINT;
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

function modelError(status: number, body: string) {
  if (status === 401 || status === 403) return "NVIDIA authentication failed. Check NVIDIA_API_KEY in Vercel settings.";
  if (status === 429) return "The model is rate limited. The next configured fallback will be tried.";
  if (status === 413) return "The model rejected this batch because it is too large for the selected context window.";
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message || `Model request failed with status ${status}.`;
  } catch {
    return `Model request failed with status ${status}.`;
  }
}

async function callNvidia(
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  temperature: number,
  maxTokens: number,
  timeoutMs: number,
) {
  const key = process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY;
  if (!key) throw new Error("NO_NVIDIA_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(nvidiaEndpoint(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
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
    if (!response.ok) throw new Error(modelError(response.status, raw));
    const parsed = JSON.parse(raw) as {
      choices?: { message?: { content?: string | Array<{ text?: string }> } }[];
    };
    const content = parsed.choices?.[0]?.message?.content;
    const output = Array.isArray(content) ? content.map((part) => part.text || "").join("") : content;
    if (!output?.trim()) throw new Error("The model returned an empty response.");
    return output.trim();
  } catch (error) {
    // Turn the opaque "This operation was aborted" into something an editor can
    // act on. Keeps the word "timeout" so isRetryableModelError still matches.
    if (error instanceof Error && (error.name === "AbortError" || controller.signal.aborted)) {
      throw new Error(`The model timed out after ${Math.round(timeoutMs / 1000)}s.`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function callNvidiaWithRetry(
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  temperature: number,
  maxTokens: number,
  deadline: ReturnType<typeof createDeadline>,
  chainLength: number,
  onRetry?: (attempt: number, reason: string) => void,
) {
  let lastError = "Model request failed.";
  for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_MODEL; attempt += 1) {
    if (!deadline.hasRoom(MIN_ATTEMPT_MS)) {
      throw new BudgetExhausted(
        `Ran out of the ${maxDuration}s function budget before ${model} could answer.`,
      );
    }
    const timeoutMs = Math.min(
      attemptTimeout(deadline, chainLength, MIN_ATTEMPT_MS, PER_ATTEMPT_CAP_MS),
      deadline.remaining(),
    );
    try {
      return await callNvidia(model, messages, temperature, maxTokens, timeoutMs);
    } catch (error) {
      if (error instanceof BudgetExhausted) throw error;
      lastError = error instanceof Error ? error.message : "Unknown model error.";
      if (!isRetryableModelError(lastError) || attempt === MAX_ATTEMPTS_PER_MODEL - 1) throw error;
      onRetry?.(attempt + 1, lastError);
      await sleep(RETRY_BACKOFF_MS[attempt] ?? 400);
    }
  }
  throw new Error(lastError);
}

export async function POST(request: NextRequest) {
  // Resolved before the try/catch on purpose, but never allowed to throw: an
  // uncaught error escapes the handler and Vercel reports it as a bare
  // 502 FUNCTION_INVOCATION_FAILED with no body, which is indistinguishable
  // from the MODEL_FAILURE 502 this route returns on purpose.
  let account: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    account = await getCurrentUser();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not verify this session.";
    console.error("Transcripter: session lookup failed", error);
    return NextResponse.json(
      { ok: false, error: message, retryable: true, code: "SESSION_ERROR" },
      { status: 500 },
    );
  }
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

    const primary = body.model?.trim() || "nvidia/llama-3.1-nemotron-ultra-253b-v1";
    const fallbacks = Array.isArray(body.fallbackModels)
      ? body.fallbackModels.filter((model): model is string => typeof model === "string" && model.trim().length > 0)
      : [];
    const models = Array.from(new Set([primary, ...fallbacks]));
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
        modelUsed: "Local safe preview",
        demo: true,
        kind,
        warning: "No NVIDIA_API_KEY is configured, so this batch used the local preview transform.",
        estimatedTokens: requestTokens,
      });
    }

    const attempts: { model: string; error: string }[] = [];
    const deadline = createDeadline(PLATFORM_BUDGET_MS - RESERVED_MS);
    let budgetExhausted = false;
    for (const model of models) {
      // Stop before starting a model that cannot get a viable attempt; the
      // platform would otherwise kill us mid-call and return a bodyless 504.
      if (!deadline.hasRoom(MIN_ATTEMPT_MS)) {
        budgetExhausted = true;
        break;
      }
      try {
        const output = await callNvidiaWithRetry(
          model,
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature,
          maxTokens,
          deadline,
          models.length,
        );
        const checks = stage === "crosscheck" ? [checkSection(text, body.batch?.index || 0)] : undefined;
        return NextResponse.json({
          ok: true,
          output,
          checks,
          modelUsed: model,
          fallbackUsed: model !== primary,
          attempts,
          estimatedTokens: requestTokens,
          kind,
          retryable: false,
        });
      } catch (error) {
        if (error instanceof BudgetExhausted) {
          budgetExhausted = true;
          attempts.push({ model, error: error.message });
          break;
        }
        const message = error instanceof Error ? error.message : "Unknown model error.";
        attempts.push({ model, error: message });
      }
    }

    if (budgetExhausted) {
      const message = `The model chain did not finish inside the ${maxDuration}-second function limit. This batch is about ${requestTokens.toLocaleString()} input tokens — lower the batch size in Settings, or raise the function's max duration in Vercel.`;
      await logError({
        ownerEmail: account.email,
        jobId: body.jobId,
        stage,
        batch: body.batch?.index,
        code: "TIMEOUT",
        message,
        detail: { attempts, kind, budgetMs: PLATFORM_BUDGET_MS - RESERVED_MS },
      });
      // retryable:false — an identical retry burns another full invocation and
      // almost always fails the same way. The UI offers a manual retry.
      return NextResponse.json(
        { ok: false, error: message, attempts, retryable: false, code: "TIMEOUT" },
        { status: 504 },
      );
    }

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
    return NextResponse.json(
      {
        ok: false,
        error: failure,
        attempts,
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
