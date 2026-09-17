import { sleep } from "./http";

export type ProviderName = "google" | "nvidia" | "openai" | "local";

export type ModelDefinition = {
  id: string;
  name: string;
  provider: ProviderName;
  description: string;
  speed: "ultra-fast" | "fast" | "balanced" | "powerful";
  contextWindow: number;
};

export const SUPPORTED_MODELS: ModelDefinition[] = [
  // Google AI Studio (Gemini) - Ultra-fast, huge context, free tier available
  {
    id: "gemini-2.0-flash",
    name: "Gemini 2.0 Flash (Google)",
    provider: "google",
    description: "Next-gen multimodal flash model: ultra-fast (~1-2s), highly accurate formatting.",
    speed: "ultra-fast",
    contextWindow: 1048576,
  },
  {
    id: "gemini-2.5-flash",
    name: "Gemini 2.5 Flash (Google)",
    provider: "google",
    description: "Latest Google Flash model with top-tier editorial reasoning and speed.",
    speed: "ultra-fast",
    contextWindow: 1048576,
  },
  {
    id: "gemini-1.5-flash",
    name: "Gemini 1.5 Flash (Google)",
    provider: "google",
    description: "Stable, high-capacity Google model with 1M token context.",
    speed: "fast",
    contextWindow: 1048576,
  },
  {
    id: "gemini-1.5-pro",
    name: "Gemini 1.5 Pro (Google)",
    provider: "google",
    description: "Deep reasoning model for dense, specialized or technical audio transcripts.",
    speed: "balanced",
    contextWindow: 2097152,
  },
  // NVIDIA NIM (Meta Llama & Nvidia Nemotron)
  {
    id: "meta/llama-3.3-70b-instruct",
    name: "Llama 3.3 70B Instruct (NVIDIA)",
    provider: "nvidia",
    description: "Flagship open-weights model for sophisticated prose editing.",
    speed: "balanced",
    contextWindow: 131072,
  },
  {
    id: "nvidia/llama-3.1-nemotron-70b-instruct",
    name: "Nemotron 70B Instruct (NVIDIA)",
    provider: "nvidia",
    description: "NVIDIA-aligned model with strong accuracy and formatting adherence.",
    speed: "balanced",
    contextWindow: 131072,
  },
  {
    id: "meta/llama-3.1-8b-instruct",
    name: "Llama 3.1 8B Instruct (NVIDIA)",
    provider: "nvidia",
    description: "Lightweight, responsive transcript processing.",
    speed: "fast",
    contextWindow: 131072,
  },
  {
    id: "mistralai/mixtral-8x7b-instruct",
    name: "Mixtral 8x7B Instruct (NVIDIA)",
    provider: "nvidia",
    description: "MoE architecture with balanced speed and nuance.",
    speed: "fast",
    contextWindow: 32768,
  },
  {
    id: "qwen/qwen2.5-72b-instruct",
    name: "Qwen 2.5 72B Instruct (NVIDIA)",
    provider: "nvidia",
    description: "Multi-language and syntax precision.",
    speed: "balanced",
    contextWindow: 32768,
  },
];

export function getProviderForModel(modelId: string): ProviderName {
  const clean = (modelId || "").trim().toLowerCase();
  if (clean.startsWith("gemini-")) return "google";
  if (clean.startsWith("gpt-")) return "openai";
  if (clean.includes("/") || clean.includes("llama") || clean.includes("nemotron") || clean.includes("mistral") || clean.includes("qwen")) {
    return "nvidia";
  }
  return "google";
}

/** Normalizes model ID with required vendor prefixes for NVIDIA NIM */
export function normalizeModelId(modelId: string): string {
  const trimmed = (modelId || "").trim();
  if (!trimmed) return "gemini-2.0-flash";

  // If it's a Gemini model, return plain model slug
  if (trimmed.toLowerCase().startsWith("gemini-")) {
    return trimmed.toLowerCase();
  }

  // Handle bare model names for NVIDIA NIM
  if (!trimmed.includes("/")) {
    if (trimmed.startsWith("llama-3.1-nemotron") || trimmed.startsWith("nemotron")) {
      return `nvidia/${trimmed}`;
    }
    if (trimmed.startsWith("llama-")) {
      return `meta/${trimmed}`;
    }
    if (trimmed.startsWith("mixtral") || trimmed.startsWith("mistral")) {
      return `mistralai/${trimmed}`;
    }
    if (trimmed.startsWith("qwen")) {
      return `qwen/${trimmed}`;
    }
  }

  return trimmed;
}

export function getGoogleApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_AI_STUDIO_API_KEY ||
    ""
  ).trim();
}

export function getNvidiaApiKey(): string {
  return (
    process.env.NVIDIA_API_KEY ||
    process.env.NVIDIA_NIM_API_KEY ||
    ""
  ).trim();
}

export function getProviderStatus(): {
  google: { available: boolean; keyHint?: string };
  nvidia: { available: boolean; keyHint?: string };
} {
  const gKey = getGoogleApiKey();
  const nKey = getNvidiaApiKey();

  return {
    google: {
      available: Boolean(gKey),
      keyHint: gKey ? `${gKey.slice(0, 4)}...${gKey.slice(-4)}` : undefined,
    },
    nvidia: {
      available: Boolean(nKey),
      keyHint: nKey ? `${nKey.slice(0, 7)}...${nKey.slice(-4)}` : undefined,
    },
  };
}

/** Call Google AI Studio (Gemini) generateContent API */
export async function callGoogleGemini(
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  temperature = 0.2,
  maxTokens = 4000,
  timeoutMs = 20000
): Promise<string> {
  const apiKey = getGoogleApiKey();
  if (!apiKey) throw new Error("NO_GOOGLE_KEY");

  // Clean model name (e.g. gemini-2.0-flash)
  const cleanModel = model.replace(/^google\//i, "").trim() || "gemini-2.0-flash";

  const systemMessage = messages.find((m) => m.role === "system")?.content || "";
  const userMessages = messages.filter((m) => m.role === "user").map((m) => m.content).join("\n\n");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${cleanModel}:generateContent?key=${apiKey}`;

  const payload: Record<string, unknown> = {
    contents: [
      {
        role: "user",
        parts: [{ text: userMessages }],
      },
    ],
    generationConfig: {
      temperature: Math.max(0, Math.min(1, temperature)),
      maxOutputTokens: Math.max(256, Math.min(8192, maxTokens)),
    },
  };

  if (systemMessage) {
    payload.systemInstruction = {
      parts: [{ text: systemMessage }],
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string; status?: string } };
        const msg = parsed.error?.message || `Google Studio API failed with status ${response.status}`;
        throw new Error(`[Google Studio] ${msg}`);
      } catch (err) {
        if (err instanceof Error && err.message.startsWith("[Google Studio]")) throw err;
        throw new Error(`[Google Studio] API failed with status ${response.status}: ${raw.slice(0, 300)}`);
      }
    }

    const parsed = JSON.parse(raw) as {
      candidates?: {
        content?: {
          parts?: { text?: string }[];
        };
      }[];
    };

    const text = parsed.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
    if (!text.trim()) {
      throw new Error("[Google Studio] Empty text returned from model.");
    }
    return text.trim();
  } finally {
    clearTimeout(timeout);
  }
}

/** Call NVIDIA NIM API */
export async function callNvidiaNim(
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  temperature = 0.2,
  maxTokens = 2048,
  timeoutMs = 15000
): Promise<string> {
  const apiKey = getNvidiaApiKey();
  if (!apiKey) throw new Error("NO_NVIDIA_KEY");

  const cleanModel = normalizeModelId(model);
  const endpoint =
    process.env.NVIDIA_ENDPOINT?.trim() ||
    process.env.AI_ENDPOINT?.trim() ||
    "https://integrate.api.nvidia.com/v1/chat/completions";

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: apiKey.startsWith("Bearer ") ? apiKey : `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        model: cleanModel,
        messages,
        temperature: Math.max(0, Math.min(1, temperature)),
        top_p: 0.9,
        max_tokens: Math.max(256, Math.min(4096, maxTokens)),
        stream: false,
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`[NVIDIA NIM] Model ${cleanModel} not found (404). Check catalog identifier.`);
      }
      if (response.status === 410) {
        throw new Error(`[NVIDIA NIM] Model ${cleanModel} is retired/deprecated (410).`);
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error("[NVIDIA NIM] Authentication failed. Check NVIDIA_API_KEY.");
      }
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: string } | string };
        const msg = typeof parsed.error === "string" ? parsed.error : parsed.error?.message;
        throw new Error(`[NVIDIA NIM] ${msg || `Status ${response.status}`}`);
      } catch (e) {
        if (e instanceof Error && e.message.startsWith("[NVIDIA NIM]")) throw e;
        throw new Error(`[NVIDIA NIM] Request failed with status ${response.status}`);
      }
    }

    const parsed = JSON.parse(raw) as {
      choices?: { message?: { content?: string | Array<{ text?: string }> } }[];
    };
    const content = parsed.choices?.[0]?.message?.content;
    const output = Array.isArray(content) ? content.map((p) => p.text || "").join("") : content;
    if (!output?.trim()) {
      throw new Error("[NVIDIA NIM] The model returned an empty response.");
    }
    return output.trim();
  } finally {
    clearTimeout(timeout);
  }
}

/** Multi-provider router: calls Google Gemini, NVIDIA NIM, or safe fallback */
export async function executeAiPass(
  model: string,
  messages: { role: "system" | "user"; content: string }[],
  temperature = 0.2,
  maxTokens = 2048,
  timeoutMs = 15000
): Promise<{ output: string; modelUsed: string; provider: ProviderName }> {
  const normalized = normalizeModelId(model);
  const provider = getProviderForModel(normalized);

  if (provider === "google") {
    const output = await callGoogleGemini(normalized, messages, temperature, maxTokens, timeoutMs);
    return { output, modelUsed: normalized, provider: "google" };
  }

  if (provider === "nvidia") {
    const output = await callNvidiaNim(normalized, messages, temperature, maxTokens, timeoutMs);
    return { output, modelUsed: normalized, provider: "nvidia" };
  }

  // Default fallback to Google if key available, else Nvidia
  if (getGoogleApiKey()) {
    const output = await callGoogleGemini("gemini-2.0-flash", messages, temperature, maxTokens, timeoutMs);
    return { output, modelUsed: "gemini-2.0-flash", provider: "google" };
  }

  const output = await callNvidiaNim(normalized, messages, temperature, maxTokens, timeoutMs);
  return { output, modelUsed: normalized, provider: "nvidia" };
}
