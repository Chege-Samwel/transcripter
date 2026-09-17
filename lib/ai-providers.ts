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
  nvidia: { available: boolean; keyHint?: string };
  openrouter: { available: boolean; keyHint?: string };
  google: { available: boolean; keyHint?: string };
} {
  const nKey = getNvidiaApiKey();
  const oKey = getOpenRouterApiKey();
  const gKey = getGoogleApiKey();

  return {
    nvidia: {
      available: Boolean(nKey),
      keyHint: nKey ? `${nKey.slice(0, 7)}...${nKey.slice(-4)}` : undefined,
    },
    openrouter: {
      available: Boolean(oKey),
      keyHint: oKey ? `${oKey.slice(0, 7)}...${oKey.slice(-4)}` : undefined,
    },
    google: {
      available: Boolean(gKey),
      keyHint: gKey ? `${gKey.slice(0, 4)}...${gKey.slice(-4)}` : undefined,
    },
  };
}

export const SUGGESTED_MODELS = [
  // User's preferred NVIDIA & OpenRouter models
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
  if (!apiKey) throw new Error("No NVIDIA API key configured");

  const endpoint =
    process.env.NVIDIA_ENDPOINT?.trim() ||
    process.env.AI_ENDPOINT?.trim() ||
    "https://integrate.api.nvidia.com/v1/chat/completions";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25000);

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
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } | string };
        const msg = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
        throw new Error(msg || `NVIDIA status ${response.status}`);
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
  if (!apiKey) throw new Error("No OpenRouter API key configured");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 25000);

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
        model: model || "google/gemma-4-26b-a4b-it:free",
        messages,
        temperature: options.temperature ?? 0.5,
        max_tokens: options.maxTokens || 8192,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
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
  if (!apiKey) throw new Error("No Google AI Studio key configured");

  const cleanModel = model.replace(/^google\//i, "").trim() || "gemini-2.0-flash";
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);

  try {
    // Use Google's OpenAI-compatible completions endpoint
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
 * Shared multi-provider cascade matching user's architecture:
 * 1. Prioritizes user's chosen custom model.
 * 2. Cascades through NVIDIA (up to 3 trials) -> OpenRouter -> Google Studio.
 */
export async function fetchAICascade(
  requestedModel: string,
  messages: { role: string; content: string }[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<{ output: string; modelUsed: string; provider: ProviderName }> {
  const nvidiaKey = getNvidiaApiKey();
  const openRouterKey = getOpenRouterApiKey();
  const googleKey = getGoogleApiKey();

  const userModel = (requestedModel || "").trim();
  const isGoogleModel = userModel.startsWith("gemini-") || userModel.startsWith("google/");
  const isOpenRouterModel = userModel.includes(":free") || userModel.startsWith("openrouter/");

  // 1. If user explicitly picked a Google model and Google key is present, execute with Google
  if (isGoogleModel && googleKey) {
    try {
      const output = await callGoogleStudio(userModel, messages, options);
      return { output, modelUsed: userModel, provider: "google" };
    } catch (e) {
      console.warn("Google Studio direct trial failed, falling back to cascade:", e);
    }
  }

  // 2. PRIMARY CASCADE: Try NVIDIA up to 3 times (with user's model or nemotron-3-ultra-550b-a55b)
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

  // 3. FALLBACK CASCADE: OpenRouter
  if (openRouterKey) {
    const targetOpenRouterModel = userModel || "google/gemma-4-26b-a4b-it:free";
    try {
      const output = await callOpenRouter(targetOpenRouterModel, messages, options);
      return { output, modelUsed: targetOpenRouterModel, provider: "openrouter" };
    } catch (e) {
      console.warn("OpenRouter trial failed:", e instanceof Error ? e.message : e);
    }
  }

  // 4. FALLBACK CASCADE: Google AI Studio
  if (googleKey) {
    const targetGoogleModel = isGoogleModel ? userModel : "gemini-2.0-flash";
    try {
      const output = await callGoogleStudio(targetGoogleModel, messages, options);
      return { output, modelUsed: targetGoogleModel, provider: "google" };
    } catch (e) {
      console.warn("Google Studio fallback failed:", e instanceof Error ? e.message : e);
    }
  }

  // If no external keys or all attempts failed, throw to let caller use local engine
  throw new Error(
    "All configured AI providers (NVIDIA, OpenRouter, Google) failed or no API keys are available."
  );
}
