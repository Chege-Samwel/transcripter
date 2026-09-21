// scripts/test-deepseek.mjs
//
// Standalone provider test for the DeepSeek integration: boots a local mock of
// api.deepseek.com, points DEEPSEEK_BASE_URL at it, and drives the real
// lib/ai-providers.ts code paths (no dev server, no database, no network).
//
// Run with: npm run test:deepseek

import assert from "node:assert/strict";
import http from "node:http";

const requests = [];
/** Responses the mock should hand back, FIFO. Defaults to a success payload. */
const scripted = [];

function successPayload(model, content = "SPEAKER 1: Edited transcript.") {
  return {
    id: "chatcmpl-test",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
  };
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    let body = null;
    try {
      body = JSON.parse(raw);
    } catch {
      body = null;
    }
    const record = {
      method: req.method,
      url: req.url,
      authorization: req.headers.authorization,
      body,
    };
    requests.push(record);

    const next = scripted.shift();
    if (next) {
      res.writeHead(next.status, { "Content-Type": "application/json" });
      res.end(typeof next.body === "string" ? next.body : JSON.stringify(next.body));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(successPayload(body?.model || "deepseek-flash")));
  });
});

function pendingRequest(index) {
  return requests[index];
}

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  // Only DeepSeek is configured for this process — other providers stay unset so
  // the routing assertions below prove DeepSeek is what answered.
  process.env.DEEPSEEK_API_KEY = "sk-test-deepseek-1234";
  process.env.DEEPSEEK_BASE_URL = baseUrl;
  delete process.env.DEEPSEEK_THINKING;
  delete process.env.DEEPSEEK_REASONING_EFFORT;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.VITE_OPENROUTER_API_KEY;
  delete process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_NIM_API_KEY;
  delete process.env.VITE_NVIDIA_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_API_KEY;

  const providers = await import("../lib/ai-providers.ts");
  const {
    callDeepSeek,
    callSingleModelWithRetries,
    fetchAICascade,
    getDeepSeekEndpoint,
    getProviderStatus,
    isDeepSeekModel,
    resolveDeepSeekModel,
  } = providers;

  const messages = [
    { role: "system", content: "You are a careful transcript editor." },
    { role: "user", content: "SPEAKER 1: um so welcome everyone" },
  ];

  // 1. Endpoint + model id resolution
  assert.equal(getDeepSeekEndpoint(), `${baseUrl}/chat/completions`);
  assert.equal(resolveDeepSeekModel("deepseek-flash"), "deepseek-flash");
  assert.equal(resolveDeepSeekModel("deepseek-v4-pro"), "deepseek-v4-pro");
  assert.equal(resolveDeepSeekModel("deepseek-chat"), "deepseek-flash", "legacy ids map to the current catalogue");
  assert.equal(resolveDeepSeekModel("deepseek/deepseek-v4-pro"), "deepseek-v4-pro", "deepseek/<id> short form is accepted");
  assert.equal(resolveDeepSeekModel(""), "deepseek-flash", "empty model falls back to the default");
  console.log("✓ DeepSeek endpoint + model id resolution");

  // 2. Model classification must not swallow the other providers' ids
  assert.equal(isDeepSeekModel("deepseek-flash"), true);
  assert.equal(isDeepSeekModel("deepseek-chat"), true);
  assert.equal(isDeepSeekModel("deepseek/deepseek-v4-pro"), true);
  assert.equal(isDeepSeekModel("gemini-2.0-flash"), false);
  assert.equal(isDeepSeekModel("google/gemma-4-26b-a4b-it:free"), false);
  assert.equal(isDeepSeekModel("nvidia/nemotron-3.5-lightning"), false);
  console.log("✓ DeepSeek model classification keeps other providers intact");

  // 3. Happy path request shape
  const output = await callDeepSeek("deepseek-flash", messages, { temperature: 0.2, maxTokens: 1234 });
  assert.equal(output, "SPEAKER 1: Edited transcript.");
  const first = pendingRequest(0);
  assert.equal(first.method, "POST");
  assert.equal(first.url, "/chat/completions");
  assert.equal(first.authorization, "Bearer sk-test-deepseek-1234");
  assert.equal(first.body.model, "deepseek-flash");
  assert.deepEqual(first.body.messages, messages);
  assert.equal(first.body.stream, false);
  assert.equal(first.body.max_tokens, 1234);
  assert.equal(first.body.temperature, 0.2);
  assert.deepEqual(first.body.thinking, { type: "disabled" }, "thinking is off by default for editorial latency");
  assert.equal("reasoning_effort" in first.body, false);
  console.log("✓ callDeepSeek sends the OpenAI-compatible body with thinking disabled");

  // 4. Thinking mode opt-in via env
  process.env.DEEPSEEK_THINKING = "enabled";
  process.env.DEEPSEEK_REASONING_EFFORT = "low";
  await callDeepSeek("deepseek-flash", messages, { temperature: 0.9, maxTokens: 512 });
  const thinkingRequest = pendingRequest(1);
  assert.deepEqual(thinkingRequest.body.thinking, { type: "enabled" });
  assert.equal(thinkingRequest.body.reasoning_effort, "low");
  assert.equal("temperature" in thinkingRequest.body, false, "thinking mode ignores temperature, so it is omitted");
  delete process.env.DEEPSEEK_THINKING;
  delete process.env.DEEPSEEK_REASONING_EFFORT;
  console.log("✓ DEEPSEEK_THINKING/DEEPSEEK_REASONING_EFFORT switch the reasoning path");

  // 5. Gateway that rejects the thinking param → one clean retry without controls
  scripted.push({
    status: 400,
    body: { error: { message: "Unknown parameter: thinking", type: "invalid_request_error" } },
  });
  const retried = await callDeepSeek("deepseek-v4-pro", messages, { temperature: 0.3 });
  assert.equal(retried, "SPEAKER 1: Edited transcript.");
  assert.equal(requests[2].body.thinking.type, "disabled");
  const retriedRequest = pendingRequest(3);
  assert.equal("thinking" in retriedRequest.body, false, "retry drops unsupported control params");
  assert.equal(retriedRequest.body.model, "deepseek-v4-pro");
  assert.equal(retriedRequest.body.temperature, 0.3);
  console.log("✓ unsupported-parameter 400 retries without the DeepSeek-only controls");

  // 6. Error mapping
  scripted.push({ status: 402, body: { error: { message: "Insufficient Balance" } } });
  await assert.rejects(() => callDeepSeek("deepseek-flash", messages), /insufficient balance/i);

  scripted.push({ status: 401, body: { error: { message: "Authentication Fails" } } });
  await assert.rejects(() => callDeepSeek("deepseek-flash", messages), /authentication failed/i);

  scripted.push({ status: 429, body: { error: { message: "Rate limit reached" } } });
  await assert.rejects(() => callDeepSeek("deepseek-flash", messages), /rate limit|concurrency/i);

  scripted.push({ status: 503, body: { error: { message: "Server is overloaded" } } });
  await assert.rejects(() => callDeepSeek("deepseek-flash", messages), /temporarily unavailable/i);

  scripted.push({
    status: 200,
    body: {
      choices: [{ message: { role: "assistant", content: "", reasoning_content: "The transcript says..." } }],
    },
  });
  await assert.rejects(() => callDeepSeek("deepseek-flash", messages), /reasoning only/i);
  console.log("✓ DeepSeek HTTP errors surface as actionable messages");

  // 7. Missing key
  const savedKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  await assert.rejects(() => callDeepSeek("deepseek-flash", messages), /No DeepSeek API key configured/);
  process.env.DEEPSEEK_API_KEY = savedKey;
  console.log("✓ missing DEEPSEEK_API_KEY fails loudly instead of silently");

  // 8. Provider status for the UI badges
  const status = getProviderStatus();
  assert.equal(status.deepseek.available, true);
  assert.equal(status.deepseek.defaultModel, "deepseek-flash");
  assert.match(status.deepseek.keyHint, /^sk-tes\.\.\.1234$/);
  console.log("✓ provider status reports DeepSeek readiness for the workspace badges");

  // 9. Single-model retries route to DeepSeek
  const single = await callSingleModelWithRetries("deepseek-flash", messages, { maxRetries: 2, retryDelayMs: 10 });
  assert.equal(single.provider, "deepseek");
  assert.equal(single.modelUsed, "deepseek-flash");
  assert.equal(single.output.trim(), "SPEAKER 1: Edited transcript.");
  console.log("✓ callSingleModelWithRetries executes on DeepSeek");

  // 10. The shared cascade picks DeepSeek first for a DeepSeek model
  const cascade = await fetchAICascade("deepseek-v4-pro", messages, { maxTokens: 800 });
  assert.equal(cascade.provider, "deepseek");
  assert.equal(cascade.modelUsed, "deepseek-v4-pro");
  console.log("✓ fetchAICascade prefers DeepSeek when a DeepSeek model is selected");

  // 11. A bare DeepSeek id without a key reports the missing key, not a mystery cascade error
  const savedKeyAgain = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  process.env.OPENROUTER_API_KEY = "sk-test-openrouter-unreachable";
  await assert.rejects(
    () => fetchAICascade("deepseek-flash", messages, { maxTokens: 400 }),
    /No DeepSeek API key configured/,
    "a bare DeepSeek id is never sent to providers that cannot serve it"
  );
  delete process.env.OPENROUTER_API_KEY;
  process.env.DEEPSEEK_API_KEY = savedKeyAgain;
  console.log("✓ a missing key for a bare DeepSeek id fails with the fix, not a cascade error");

  // 12. A DeepSeek outage cascades onward instead of aborting the run
  const before = requests.length;
  scripted.push({ status: 500, body: { error: { message: "internal error" } } });
  process.env.OPENROUTER_API_KEY = "sk-test-openrouter-unreachable";
  await assert.rejects(
    () => fetchAICascade("deepseek-flash", messages, { maxTokens: 400 }),
    /All configured AI providers/,
    "with DeepSeek down and no reachable fallback the real provider error is reported"
  );
  delete process.env.OPENROUTER_API_KEY;
  assert.equal(requests.length, before + 1, "DeepSeek was attempted first, then the cascade moved on");
  console.log("✓ a failed DeepSeek pass cascades to the remaining providers");

  console.log("\nAll DeepSeek provider checks passed.");
}

main()
  .catch((error) => {
    console.error("\n✗ DeepSeek provider test failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    server.close();
  });
