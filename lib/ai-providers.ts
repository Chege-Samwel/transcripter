export type ProviderName = "nvidia" | "openrouter" | "google" | "deepseek" | "local";

export function getNvidiaApiKey(): string {
  return (
    process.env.NVIDIA_API_KEY ||
    process.env.VITE_NVIDIA_API_KEY ||
    process.env.NVIDIA_NIM_API_KEY ||
    ""
  ).trim();
}

export function getOpenRouterApiKey(): string {
  return (
    process.env.OPENROUTER_API_KEY ||
    process.env.VITE_OPENROUTER_API_KEY ||
    ""
  ).trim();
}

export function getGoogleApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_AI_STUDIO_API_KEY ||
    ""
  ).trim();
}

export function getDeepSeekApiKey(): string {
  return (
    process.env.DEEPSEEK_API_KEY ||
    process.env.DEEPSEEK_API_TOKEN ||
    process.env.VITE_DEEPSEEK_API_KEY ||
    process.env.DEEPSEEK_KEY ||
    ""
  ).trim();
}

export function getProviderStatus(): {
  nvidia: { available: boolean; keyHint?: string; defaultModel: string };
  openrouter: { available: boolean; keyHint?: string; defaultModel: string };
  google: { available: boolean; keyHint?: string; defaultModel: string };
  deepseek: { available: boolean; keyHint?: string; defaultModel: string };
} {
  const nKey = getNvidiaApiKey();
  const oKey = getOpenRouterApiKey();
  const gKey = getGoogleApiKey();
  const dKey = getDeepSeekApiKey();

  return {
    nvidia: {
      available: Boolean(nKey),
      keyHint: nKey ? `${nKey.slice(0, 7)}...${nKey.slice(-4)}` : undefined,
      defaultModel: "nvidia/nemotron-3-ultra-550b-a55b",
    },
    openrouter: {
      available: Boolean(oKey),
      keyHint: oKey ? `${oKey.slice(0, 7)}...${oKey.slice(-4)}` : undefined,
      defaultModel: "nvidia/nemotron-3.5-lightning:free",
    },
    google: {
      available: Boolean(gKey),
      keyHint: gKey ? `${gKey.slice(0, 4)}...${gKey.slice(-4)}` : undefined,
      defaultModel: "gemini-2.0-flash",
    },
    deepseek: {
      available: Boolean(dKey),
      keyHint: dKey ? `${dKey.slice(0, 6)}...${dKey.slice(-4)}` : undefined,
      defaultModel: DEEPSEEK_DEFAULT_MODEL,
    },
  };
}

export const SUGGESTED_MODELS = [
  // High-throughput Lightning & free models
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3.5-lightning",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "google/gemma-4-26b-a4b-it:free",
  // DeepSeek (api.deepseek.com)
  "deepseek-flash",
  "deepseek-v4-pro",
  // Google AI Studio
  "gemini-2.0-flash",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
  // NVIDIA NIM Catalog
  "nvidia/llama-3.1-nemotron-70b-instruct",
  "meta/llama-3.3-70b-instruct",
  "mistralai/mixtral-8x7b-instruct",
];

export async function callNvidia(
  model: string,
  messages: { role: string; content: string }[],
  options: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  const apiKey = getNvidiaApiKey();
  if (!apiKey) throw new Error("No NVIDIA API key configured (set NVIDIA_API_KEY).");

  const endpoint =
    process.env.NVIDIA_ENDPOINT?.trim() ||
    process.env.AI_ENDPOINT?.trim() ||
    "https://integrate.api.nvidia.com/v1/chat/completions";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 35000);

  const isNemotron = model.toLowerCase().includes("nemotron");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: options.maxTokens || 8192,
        temperature: options.temperature ?? 0.5,
        ...(isNemotron ? { chat_template_kwargs: { enable_thinking: true } } : {}),
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      if (response.status === 410) throw new Error(`Model ${model} is retired/deprecated (410) on NVIDIA.`);
      if (response.status === 404) throw new Error(`Model ${model} not found (404) on NVIDIA.`);
      if (response.status === 401 || response.status === 403) throw new Error("NVIDIA authentication failed (check NVIDIA_API_KEY).");
      if (response.status === 429) throw new Error("NVIDIA rate limit reached (429).");
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } | string };
        const msg = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
        throw new Error(msg || `NVIDIA error status ${response.status}`);
      } catch (err) {
        if (err instanceof Error && !err.message.startsWith("JSON")) throw err;
        throw new Error(`NVIDIA request failed with status ${response.status}`);
      }
    }

    const data = JSON.parse(raw) as {
      choices?: { message?: { content?: string | Array<{ text?: string }> } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    const output = Array.isArray(content) ? content.map((p) => p.text || "").join("") : content;
    if (!output?.trim()) throw new Error("NVIDIA returned an empty response.");
    return output.trim();
  } finally {
    clearTimeout(timeout);
  }
}

export async function callOpenRouter(
  model: string,
  messages: { role: string; content: string }[],
  options: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error("No OpenRouter API key configured (set OPENROUTER_API_KEY).");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 35000);

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://transcripter-3xd6.onrender.com",
        "X-Title": "Transcripter Editorial Studio",
      },
      body: JSON.stringify({
        model: model || "nvidia/nemotron-3.5-lightning:free",
        messages,
        temperature: options.temperature ?? 0.5,
        max_tokens: options.maxTokens || 8192,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      if (response.status === 429) throw new Error(`OpenRouter rate limit exceeded on ${model} (429). Please retry.`);
      if (response.status === 401 || response.status === 403) throw new Error("OpenRouter authentication failed (check OPENROUTER_API_KEY).");
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } };
        throw new Error(parsed.error?.message || `OpenRouter status ${response.status}`);
      } catch (err) {
        if (err instanceof Error && !err.message.startsWith("JSON")) throw err;
        throw new Error(`OpenRouter failed with status ${response.status}`);
      }
    }

    const data = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[];
    };
    const output = data.choices?.[0]?.message?.content;
    if (!output?.trim()) throw new Error("OpenRouter returned an empty response.");
    return output.trim();
  } finally {
    clearTimeout(timeout);
  }
}

export async function callGoogleStudio(
  model: string,
  messages: { role: string; content: string }[],
  options: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {}
): Promise<string> {
  const apiKey = getGoogleApiKey();
  if (!apiKey) throw new Error("No Google AI Studio key configured (set GEMINI_API_KEY).");

  const cleanModel = model.replace(/^google\//i, "").trim() || "gemini-2.0-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25000);

  try {
    const response = await fetch("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cleanModel,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens || 8192,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      if (response.status === 429) throw new Error(`Google Studio rate limit exceeded on ${cleanModel} (429). Please retry.`);
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } };
        throw new Error(parsed.error?.message || `Google Studio status ${response.status}`);
      } catch (err) {
        if (err instanceof Error && !err.message.startsWith("JSON")) throw err;
        throw new Error(`Google Studio failed with status ${response.status}`);
      }
    }

    const data = JSON.parse(raw) as {
      choices?: { message?: { content?: string } }[];
    };
    const output = data.choices?.[0]?.message?.content;
    if (!output?.trim()) throw new Error("Google Studio returned an empty response.");
    return output.trim();
  } finally {
    clearTimeout(timeout);
  }
}

/* ------------------------------------------------------------------ *
 * DeepSeek (https://api.deepseek.com — OpenAI-compatible chat API)
 * ------------------------------------------------------------------ */

export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";

/** Current DeepSeek API model ids, newest first. */
export const DEEPSEEK_MODELS = ["deepseek-flash", "deepseek-v4-pro"];

/**
 * Retired / legacy DeepSeek model ids. DeepSeek still answers some of them, but
 * the hosted model behind them has been replaced, so we map them to the current
 * catalogue before sending the request.
 */
const DEEPSEEK_LEGACY_MODEL_ALIASES: Record<string, string> = {
  "deepseek-chat": "deepseek-flash",
  "deepseek-coder": "deepseek-flash",
  "deepseek-reasoner": "deepseek-flash",
  "deepseek-r1": "deepseek-flash",
  "deepseek-r1-0528": "deepseek-flash",
  "deepseek-v2": "deepseek-flash",
  "deepseek-v2.5": "deepseek-flash",
  "deepseek-v3": "deepseek-flash",
  "deepseek-v3-0324": "deepseek-flash",
  "deepseek-v3.1": "deepseek-flash",
  "deepseek-v3.1-terminus": "deepseek-flash",
  "deepseek-v3.2": "deepseek-flash",
  "deepseek-v3.2-exp": "deepseek-flash",
  "deepseek-v4-flash": "deepseek-flash",
  "deepseek-v4-flash-vision-exp": "deepseek-flash",
};

/** Models whose name implies DeepSeek's thinking (chain-of-thought) mode. */
const DEEPSEEK_THINKING_HINTS = /reasoner|thinking|\br1\b|-r1$|v4-pro-max/i;

/**
 * OpenRouter also publishes `deepseek/...` slugs, so routing a model to the
 * DeepSeek API takes an explicit match: a bare DeepSeek id (`deepseek-flash`,
 * `deepseek-v4-pro`, a legacy alias) or the `deepseek/<id>` short form.
 * OpenRouter-hosted ids stay untouched because `openrouter/` and `:free` models
 * are routed to OpenRouter before this check runs.
 */
export function isDeepSeekModel(model: string): boolean {
  const trimmed = (model || "").trim().toLowerCase();
  if (!trimmed) return false;
  const bare = trimmed.replace(/^deepseek\//, "").replace(/^openrouter\//, "").trim();
  if (!bare) return false;
  if (DEEPSEEK_LEGACY_MODEL_ALIASES[bare]) return true;
  return /^deepseek[-\w.]*$/.test(bare);
}

/** Map user-supplied DeepSeek ids (including legacy aliases) to an API model id. */
export function resolveDeepSeekModel(model: string): string {
  const trimmed = (model || "").trim().replace(/^deepseek\//i, "").replace(/^openrouter\//i, "");
  const bare = trimmed.trim().toLowerCase();
  const resolved = DEEPSEEK_LEGACY_MODEL_ALIASES[bare] || trimmed.trim();
  return resolved || DEEPSEEK_DEFAULT_MODEL;
}

/** Chat-completions URL, overridable for gateways/proxies via env. */
export function getDeepSeekEndpoint(): string {
  const raw = (
    process.env.DEEPSEEK_BASE_URL ||
    process.env.DEEPSEEK_API_BASE ||
    process.env.DEEPSEEK_ENDPOINT ||
    "https://api.deepseek.com"
  ).trim();
  const base = raw.replace(/\/+$/, "");
  if (!base) return "https://api.deepseek.com/chat/completions";
  return /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
}

export type DeepSeekThinking = "enabled" | "disabled";

/**
 * Thinking mode is on by default in DeepSeek's API. Editorial passes are latency
 * bound (the route runs inside a 30–60s serverless window), so thinking stays off
 * unless `DEEPSEEK_THINKING=enabled` — or the chosen id is a reasoning model.
 */
export function resolveDeepSeekThinking(model: string): DeepSeekThinking {
  const raw = (process.env.DEEPSEEK_THINKING || process.env.DEEPSEEK_THINKING_MODE || "").trim().toLowerCase();
  if (["1", "true", "on", "yes", "enabled", "enable", "thinking", "low", "high", "max", "medium", "minimal", "xhigh", "ultra"].includes(raw)) {
    return "enabled";
  }
  if (["0", "false", "off", "no", "disabled", "disable", "none"].includes(raw)) {
    return "disabled";
  }
  return DEEPSEEK_THINKING_HINTS.test(model) ? "enabled" : "disabled";
}

function getDeepSeekReasoningEffort(): string | undefined {
  const raw = (process.env.DEEPSEEK_REASONING_EFFORT || "").trim().toLowerCase();
  if (!raw) return undefined;
  return ["minimal", "low", "medium", "high", "xhigh", "max", "none"].includes(raw) ? raw : undefined;
}

type DeepSeekErrorPayload = { error?: { message?: string } | string };

function deepSeekErrorMessage(payload: DeepSeekErrorPayload, status: number, model: string): string {
  const apiMessage =
    typeof payload.error === "string" ? payload.error : payload.error?.message?.trim();
  if (status === 401 || status === 403) return "DeepSeek authentication failed (check DEEPSEEK_API_KEY).";
  if (status === 402) return "DeepSeek account has insufficient balance (402). Top up at platform.deepseek.com.";
  if (status === 404) return `DeepSeek model "${model}" not found (404). Use deepseek-flash or deepseek-v4-pro.`;
  if (status === 422) return apiMessage || `DeepSeek rejected the request parameters (422) for model "${model}".`;
  if (status === 429) return apiMessage || `DeepSeek rate limit or concurrency limit reached (429) on ${model}. Please retry.`;
  if (status === 500 || status === 503) return `DeepSeek is temporarily unavailable (${status}) on ${model}. Please retry.`;
  return apiMessage || `DeepSeek request failed with status ${status}.`;
}

/**
 * Execute one pass on DeepSeek's OpenAI-compatible chat completions endpoint.
 * Thinking mode is disabled by default so transcript batches come back fast and
 * cheap; set DEEPSEEK_THINKING=enabled (and optionally DEEPSEEK_REASONING_EFFORT)
 * to use the reasoning path.
 */
export async function callDeepSeek(
  model: string,
  messages: { role: string; content: string }[],
  options: { temperature?: number; maxTokens?: number; timeoutMs?: number; thinking?: DeepSeekThinking } = {}
): Promise<string> {
  const apiKey = getDeepSeekApiKey();
  if (!apiKey) throw new Error("No DeepSeek API key configured (set DEEPSEEK_API_KEY).");

  const endpoint = getDeepSeekEndpoint();
  const targetModel = resolveDeepSeekModel(model);
  const thinking = options.thinking || resolveDeepSeekThinking(model);
  const reasoningEffort = thinking === "enabled" ? getDeepSeekReasoningEffort() : undefined;
  const rawTemperature = Number(options.temperature);
  const temperature = Number.isFinite(rawTemperature) ? Math.min(2, Math.max(0, rawTemperature)) : 0.5;
  // DeepSeek accepts up to 384K output tokens; keep the app's editorial budget.
  const maxTokens = Math.min(Math.max(1, Math.round(options.maxTokens || 8192)), 384_000);

  const buildBody = (includeThinkingControls: boolean) => ({
    model: targetModel,
    messages,
    max_tokens: maxTokens,
    stream: false,
    // Thinking mode ignores temperature, so only send it in non-thinking mode.
    ...(thinking === "disabled" ? { temperature } : {}),
    ...(includeThinkingControls
      ? {
          thinking: { type: thinking },
          ...(reasoningEffort ? { reasoning_effort: reasoningEffort } : {}),
        }
      : {}),
  });

  const send = async (includeThinkingControls: boolean) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 40000);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildBody(includeThinkingControls)),
        signal: controller.signal,
      });
      const raw = await response.text();
      return { response, raw };
    } finally {
      clearTimeout(timeout);
    }
  };

  try {
    let { response, raw } = await send(true);

    // Older DeepSeek-compatible gateways reject unknown control params. If that
    // is the only complaint, retry once with the plain OpenAI-style body.
    if (response.status === 400) {
      const hint = raw.toLowerCase();
      if (hint.includes("thinking") || hint.includes("reasoning_effort")) {
        ({ response, raw } = await send(false));
      }
    }

    if (!response.ok) {
      let payload: DeepSeekErrorPayload = {};
      try {
        payload = JSON.parse(raw) as DeepSeekErrorPayload;
      } catch {
        payload = {};
      }
      throw new Error(deepSeekErrorMessage(payload, response.status, targetModel));
    }

    const data = JSON.parse(raw) as {
      choices?: { message?: { content?: string | null; reasoning_content?: string | null } }[];
      error?: { message?: string } | string;
    };
    if (data.error) throw new Error(deepSeekErrorMessage({ error: data.error }, response.status, targetModel));

    const output = data.choices?.[0]?.message?.content;
    if (!output?.trim()) {
      const reasoning = data.choices?.[0]?.message?.reasoning_content;
      if (reasoning?.trim()) {
        throw new Error(
          "DeepSeek returned reasoning only, with no final transcript. Retry, or set DEEPSEEK_THINKING=disabled for direct answers."
        );
      }
      throw new Error("DeepSeek returned an empty response.");
    }
    return output.trim();
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(
        `DeepSeek did not answer within ${Math.round((options.timeoutMs || 40000) / 1000)}s on ${targetModel}. Reduce batch size or turn thinking mode off.`
      );
    }
    if (error instanceof TypeError) {
      // fetch() network/DNS failures surface as a bare "fetch failed".
      throw new Error(
        `Could not reach DeepSeek at ${endpoint} (${error.message}). Check DEEPSEEK_BASE_URL and outbound network access.`
      );
    }
    throw error;
  }
}

/**
 * Execute on one specific model with automatic retries and exponential backoff.
 * Especially tailored for high-throughput models like nvidia/nemotron-3.5-lightning:free or nvidia/nemotron-3.5-lightning.
 */
export async function callSingleModelWithRetries(
  model: string,
  messages: { role: string; content: string }[],
  options: {
    temperature?: number;
    maxTokens?: number;
    maxRetries?: number;
    retryDelayMs?: number;
  } = {}
): Promise<{ output: string; modelUsed: string; provider: ProviderName }> {
  const maxRetries = options.maxRetries ?? 3;
  const initialDelay = options.retryDelayMs ?? 800;
  const nvidiaKey = getNvidiaApiKey();
  const openRouterKey = getOpenRouterApiKey();
  const googleKey = getGoogleApiKey();
  const deepSeekKey = getDeepSeekApiKey();

  const isFreeModel = model.includes(":free");
  const isOpenRouterModel = model.startsWith("openrouter/") || isFreeModel;
  const isGoogleModel = model.startsWith("gemini-") || model.startsWith("google/");
  const isDeepSeekDirect = isDeepSeekModel(model) && !isFreeModel;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. If OpenRouter model or free model (e.g. nvidia/nemotron-3.5-lightning:free):
      if (isOpenRouterModel || (!nvidiaKey && !isDeepSeekDirect && openRouterKey && !isGoogleModel)) {
        if (!openRouterKey) throw new Error("No OpenRouter API key configured (set OPENROUTER_API_KEY).");
        const output = await callOpenRouter(model, messages, options);
        return { output, modelUsed: model, provider: "openrouter" };
      }

      // 2. If Google model:
      if (isGoogleModel) {
        if (!googleKey) throw new Error("No Google AI Studio key configured (set GEMINI_API_KEY).");
        const output = await callGoogleStudio(model, messages, options);
        return { output, modelUsed: model, provider: "google" };
      }

      // 3. If DeepSeek model (deepseek-flash, deepseek-v4-pro, legacy deepseek-chat):
      if (isDeepSeekDirect) {
        if (!deepSeekKey) throw new Error("No DeepSeek API key configured (set DEEPSEEK_API_KEY).");
        try {
          const output = await callDeepSeek(model, messages, options);
          return { output, modelUsed: model, provider: "deepseek" };
        } catch (deepSeekError) {
          // A `deepseek/<id>` string is also a valid OpenRouter slug, so on the
          // final attempt let OpenRouter serve the same model if it has a key.
          if (openRouterKey && attempt === maxRetries && model.includes("/")) {
            try {
              const output = await callOpenRouter(model, messages, options);
              return { output, modelUsed: model, provider: "openrouter" };
            } catch {
              // surface the original DeepSeek error below
            }
          }
          throw deepSeekError;
        }
      }

      // 4. If NVIDIA model (e.g. nvidia/nemotron-3.5-lightning or nvidia/nemotron-3-ultra-550b-a55b):
      if (nvidiaKey && !isDeepSeekModel(model)) {
        try {
          const output = await callNvidia(model, messages, options);
          return { output, modelUsed: model, provider: "nvidia" };
        } catch (nimError) {
          // If NVIDIA NIM failed and OpenRouter is available, retry that same model on OpenRouter
          if (openRouterKey && attempt === maxRetries) {
            try {
              const output = await callOpenRouter(model, messages, options);
              return { output, modelUsed: model, provider: "openrouter" };
            } catch {
              // ignore OpenRouter secondary and throw nimError
            }
          }
          throw nimError;
        }
      }

      // 5. If only OpenRouter is configured, route model through OpenRouter:
      if (openRouterKey) {
        const output = await callOpenRouter(model, messages, options);
        return { output, modelUsed: model, provider: "openrouter" };
      }

      throw new Error(`No provider API key configured to execute model "${model}". Set DEEPSEEK_API_KEY, OPENROUTER_API_KEY, NVIDIA_API_KEY, or GEMINI_API_KEY.`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[AI Retry ${attempt}/${maxRetries}] Model "${model}" failed: ${lastError.message}`);
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, initialDelay * attempt));
      }
    }
  }

  throw new Error(`Model "${model}" failed after ${maxRetries} attempt(s): ${lastError?.message || "Unknown error"}`);
}

/**
 * Shared multi-provider cascade:
 * - If singleModelOnly is true or user picked a lightning/free model, executes retries on that model specifically.
 * - Otherwise cascades through DeepSeek (when a DeepSeek model is picked) -> NVIDIA NIM -> OpenRouter -> Google Studio.
 * - Throws real errors instead of falling back to a fake local engine.
 */
export async function fetchAICascade(
  requestedModel: string,
  messages: { role: string; content: string }[],
  options: {
    temperature?: number;
    maxTokens?: number;
    singleModelOnly?: boolean;
    maxRetries?: number;
  } = {}
): Promise<{ output: string; modelUsed: string; provider: ProviderName }> {
  const userModel = (requestedModel || "").trim();

  // If user explicitly picked single model mode or a lightning / free model,
  // execute retries exclusively on that model!
  if (
    options.singleModelOnly ||
    userModel.includes("lightning") ||
    userModel.includes(":free")
  ) {
    return callSingleModelWithRetries(userModel, messages, options);
  }

  const nvidiaKey = getNvidiaApiKey();
  const openRouterKey = getOpenRouterApiKey();
  const googleKey = getGoogleApiKey();
  const deepSeekKey = getDeepSeekApiKey();

  const isGoogleModel = userModel.startsWith("gemini-") || userModel.startsWith("google/");
  const isOpenRouterModel = userModel.startsWith("openrouter/");
  const isDeepSeekDirect = isDeepSeekModel(userModel) && !userModel.includes(":free");

  // A bare DeepSeek id can only be served by DeepSeek, so report the missing key
  // instead of pushing it through providers that have never heard of it.
  if (isDeepSeekDirect && !deepSeekKey && !userModel.includes("/")) {
    throw new Error(`No DeepSeek API key configured (set DEEPSEEK_API_KEY) to run "${userModel}".`);
  }

  // 1. Direct DeepSeek trial when the chosen model is a DeepSeek one
  if (isDeepSeekDirect && deepSeekKey) {
    try {
      const output = await callDeepSeek(userModel, messages, options);
      return { output, modelUsed: userModel, provider: "deepseek" };
    } catch (e) {
      console.warn("DeepSeek direct trial failed, cascading:", e instanceof Error ? e.message : e);
    }
  }

  // 2. Direct Google Studio trial if user chose a Google model
  if (isGoogleModel && googleKey) {
    try {
      const output = await callGoogleStudio(userModel, messages, options);
      return { output, modelUsed: userModel, provider: "google" };
    } catch (e) {
      console.warn("Google Studio direct trial failed, cascading:", e);
    }
  }

  // 3. NVIDIA NIM Cascade (up to 3 trials) — skipped for DeepSeek/OpenRouter model ids
  if (nvidiaKey && !isOpenRouterModel && !isDeepSeekDirect) {
    const targetNvidiaModel = userModel && !isGoogleModel
      ? userModel
      : "nvidia/nemotron-3-ultra-550b-a55b";

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const output = await callNvidia(targetNvidiaModel, messages, options);
        return { output, modelUsed: targetNvidiaModel, provider: "nvidia" };
      } catch (e) {
        console.warn(`NVIDIA trial ${attempt} failed with model ${targetNvidiaModel}:`, e instanceof Error ? e.message : e);
      }
      if (attempt < 3) await new Promise((r) => setTimeout(r, 800));
    }
  }

  // 4. OpenRouter Cascade (up to 2 trials)
  if (openRouterKey) {
    const targetOpenRouterModel = userModel || "nvidia/nemotron-3.5-lightning:free";
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const output = await callOpenRouter(targetOpenRouterModel, messages, options);
        return { output, modelUsed: targetOpenRouterModel, provider: "openrouter" };
      } catch (e) {
        console.warn(`OpenRouter trial ${attempt} failed:`, e instanceof Error ? e.message : e);
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // 5. Google Studio Cascade
  if (googleKey) {
    const targetGoogleModel = isGoogleModel ? userModel : "gemini-2.0-flash";
    try {
      const output = await callGoogleStudio(targetGoogleModel, messages, options);
      return { output, modelUsed: targetGoogleModel, provider: "google" };
    } catch (e) {
      console.warn("Google Studio fallback failed:", e instanceof Error ? e.message : e);
    }
  }

  // All providers failed
  throw new Error(
    "All configured AI providers (DeepSeek, NVIDIA, OpenRouter, Google) failed. Please check your API keys or switch to another model to retry."
  );
}
