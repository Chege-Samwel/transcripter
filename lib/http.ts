export async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export type JsonResult<T = Record<string, unknown>> = {
  ok: boolean;
  status: number;
  data: T;
};

type RequestControl = {
  retries?: number;
  onRetry?: (attempt: number, reason: string) => void;
};

export async function requestJson<T = Record<string, unknown>>(
  url: string,
  options: RequestInit = {},
  control: RequestControl = {},
): Promise<JsonResult<T>> {
  const retries = control.retries ?? 2;
  let lastStatus = 0;
  let lastReason = "Request failed.";

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        cache: "no-store",
        credentials: "include",
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...(options.headers || {}),
        },
      });
      lastStatus = response.status;
      const text = await response.text();
      let data: T;
      try {
        data = (text ? JSON.parse(text) : {}) as T;
      } catch {
        lastReason = "The server returned an unreadable response.";
        if (attempt < retries && response.status >= 500) {
          control.onRetry?.(attempt + 1, lastReason);
          await sleep(400 * 2 ** attempt);
          continue;
        }
        return { ok: false, status: response.status, data: { error: lastReason, code: "BAD_RESPONSE" } as T };
      }
      const payload = data as { ok?: boolean; error?: string; retryable?: boolean };
      // A 5xx body carrying `retryable: false` is a deterministic failure the
      // server already diagnosed (bad model credentials, unknown model, demo
      // cap, exhausted function budget). Re-sending it just repeats the same
      // expensive work — /api/process retries internally across fallback
      // models, so a client-side re-send multiplies the cost by three.
      const serverSaysFinal = payload.retryable === false;
      const retryableHttp = !serverSaysFinal && (response.status === 429 || response.status >= 500);
      if (retryableHttp && attempt < retries) {
        lastReason = payload.error || `HTTP ${response.status}`;
        control.onRetry?.(attempt + 1, lastReason);
        await sleep(400 * 2 ** attempt);
        continue;
      }
      return { ok: response.ok && payload.ok !== false, status: response.status, data };
    } catch (error) {
      lastReason = error instanceof Error ? error.message : "Network error.";
      lastStatus = 0;
      if (attempt < retries) {
        control.onRetry?.(attempt + 1, lastReason);
        await sleep(400 * 2 ** attempt);
        continue;
      }
    }
  }

  return { ok: false, status: lastStatus, data: { error: lastReason, code: "NETWORK" } as T };
}
