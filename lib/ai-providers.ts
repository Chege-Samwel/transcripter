export type ProviderName = "nvidia" | "openrouter" | "google" | "local";

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

export function getProviderStatus(): {
  nvidia: { available: boolean; keyHint?: string; defaultModel: string };
  openrouter: { available: boolean; keyHint?: string; defaultModel: string };
  google: { available: boolean; keyHint?: string; defaultModel: string };
} {
  const nKey = getNvidiaApiKey();
  const oKey = getOpenRouterApiKey();
  const gKey = getGoogleApiKey();

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
  };
}

export const SUGGESTED_MODELS = [
  // High-throughput Lightning & free models
  "nvidia/nemotron-3.5-lightning:free",
  "nvidia/nemotron-3.5-lightning",
  "nvidia/nemotron-3-ultra-550b-a55b",
  "google/gemma-4-26b-a4b-it:free",
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

  const isFreeModel = model.includes(":free");
  const isOpenRouterModel = model.startsWith("openrouter/") || isFreeModel;
  const isGoogleModel = model.startsWith("gemini-") || model.startsWith("google/");

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // 1. If OpenRouter model or free model (e.g. nvidia/nemotron-3.5-lightning:free):
      if (isOpenRouterModel || (!nvidiaKey && openRouterKey && !isGoogleModel)) {
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

      // 3. If NVIDIA model (e.g. nvidia/nemotron-3.5-lightning or nvidia/nemotron-3-ultra-550b-a55b):
      if (nvidiaKey) {
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

      // 4. If only OpenRouter is configured, route model through OpenRouter:
      if (openRouterKey) {
        const output = await callOpenRouter(model, messages, options);
        return { output, modelUsed: model, provider: "openrouter" };
      }

      throw new Error(`No provider API key configured to execute model "${model}". Set OPENROUTER_API_KEY, NVIDIA_API_KEY, or GEMINI_API_KEY.`);
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
 * - Otherwise cascades through NVIDIA NIM -> OpenRouter -> Google Studio.
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

  const isGoogleModel = userModel.startsWith("gemini-") || userModel.startsWith("google/");
  const isOpenRouterModel = userModel.startsWith("openrouter/");

  // 1. Direct Google Studio trial if user chose a Google model
  if (isGoogleModel && googleKey) {
    try {
      const output = await callGoogleStudio(userModel, messages, options);
      return { output, modelUsed: userModel, provider: "google" };
    } catch (e) {
      console.warn("Google Studio direct trial failed, cascading:", e);
    }
  }

  // 2. NVIDIA NIM Cascade (up to 3 trials)
  if (nvidiaKey && !isOpenRouterModel) {
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

  // 3. OpenRouter Cascade (up to 2 trials)
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

  // 4. Google Studio Cascade
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
    "All configured AI providers (NVIDIA, OpenRouter, Google) failed. Please check your API keys or switch to another model to retry."
  );
}
