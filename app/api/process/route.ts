import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

type Stage = "normalize" | "format" | "edit" | "crosscheck";

type ProcessBody = {
  stage?: Stage;
  text?: string;
  masterPrompt?: string;
  formatRules?: string;
  editRules?: string;
  model?: string;
  fallbackModels?: string[];
  contextWindow?: number;
  maxOutputTokens?: number;
  temperature?: number;
  batch?: { index?: number; total?: number };
  contextBefore?: string;
};

const NVIDIA_ENDPOINT = "https://integrate.api.nvidia.com/v1/chat/completions";

const stageInstructions: Record<Stage, string> = {
  normalize:
    "Normalize the transcript without changing its meaning. Repair obvious spacing, punctuation, line break, and speaker-label inconsistencies. Keep every meaningful word and mark uncertainty instead of inventing content.",
  format:
    "Apply the requested formatting contract. Make structure, headings, speaker labels, paragraphs, and line breaks consistent. Do not summarize, add facts, or remove meaningful content.",
  edit:
    "Apply the editing contract carefully. Improve readability and grammar while preserving intent, claims, chronology, and speaker attribution. Never manufacture missing words. Return only the edited transcript.",
  crosscheck:
    "Review the supplied section against the rules. Do not rewrite it. Return a compact quality note identifying only concrete issues, unresolved transcript markers, or rule violations.",
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

  if (stage === "edit") {
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
) {
  const key = process.env.NVIDIA_API_KEY || process.env.NVIDIA_NIM_API_KEY;
  if (!key) throw new Error("NO_NVIDIA_KEY");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 50_000);
  try {
    const response = await fetch(NVIDIA_ENDPOINT, {
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
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ProcessBody;
    const stage = body.stage || "edit";
    const text = body.text?.trim() || "";
    const contextWindow = Math.max(2048, Number(body.contextWindow) || 32768);
    const formatRules = body.formatRules?.trim() || "Preserve readable paragraphs.";
    const editRules = body.editRules?.trim() || "Polish grammar without changing meaning.";
    const masterPrompt = body.masterPrompt?.trim() || "Be a careful transcript editor. Preserve the speaker's meaning and uncertainty.";

    if (!text) {
      return NextResponse.json({ ok: false, error: "This process received an empty batch." }, { status: 400 });
    }
    if (!["normalize", "format", "edit", "crosscheck"].includes(stage)) {
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
      `Transcript batch:\n${text}`,
      continuity,
    ].join("\n\n");
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
        warning: "No NVIDIA_API_KEY is configured, so this batch used the local preview transform.",
        estimatedTokens: requestTokens,
      });
    }

    const attempts: { model: string; error: string }[] = [];
    for (const model of models) {
      try {
        const output = await callNvidia(
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
          modelUsed: model,
          fallbackUsed: model !== primary,
          attempts,
          estimatedTokens: requestTokens,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown model error.";
        attempts.push({ model, error: message });
      }
    }

    return NextResponse.json(
      {
        ok: false,
        error: attempts[attempts.length - 1]?.error || "Every configured model failed.",
        attempts,
      },
      { status: 502 },
    );
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not process this workflow request." },
      { status: 500 },
    );
  }
}
