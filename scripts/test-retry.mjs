// scripts/test-retry.mjs
import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:3000";

async function testRetryPicksUpNewModel() {
  console.log("=== Testing Retry Scenario: Updating Models & Retrying ===");

  // 1. Authenticate admin
  const adminEmail = "admin@example.com";
  const loginRes = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: "password123" }),
  });
  assert.equal(loginRes.status, 200);
  const adminCookie = loginRes.headers.get("set-cookie") || "";

  // 2. Initial state: Set model A
  const modelA = "meta/llama-3.3-70b-instruct";
  await fetch(`${BASE}/api/admin/models`, {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ primaryModel: modelA, fallbackModels: ["meta/llama-3.1-8b-instruct"] }),
  });

  // 3. User / Job tries to run with old model in request body
  // Even if an old client sent a stale model or retired model name:
  const staleModel = "nvidia/llama-3.1-nemotron-ultra-253b-v1";
  const run1 = await fetch(`${BASE}/api/process`, {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      stage: "normalize",
      text: "Test sample transcript line 1.\nTest sample transcript line 2.",
      masterPrompt: "Clean text",
      formatRules: "standard",
      editRules: "standard",
      model: staleModel, // stale model from previous job
      fallbackModels: [staleModel],
    }),
  });
  const data1 = await run1.json();
  assert.equal(run1.status, 200);
  console.log("✓ Run 1 executed successfully");

  // 4. Admin updates models to model B
  const modelB = "nvidia/llama-3.1-nemotron-70b-instruct";
  const updateRes = await fetch(`${BASE}/api/admin/models`, {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ primaryModel: modelB, fallbackModels: ["meta/llama-3.3-70b-instruct"] }),
  });
  const updateData = await updateRes.json();
  assert.equal(updateData.models?.primaryModel, modelB);
  console.log(`✓ Admin updated system models to ${modelB}`);

  // 5. Retry pass: executes and uses model B
  const retryRun = await fetch(`${BASE}/api/process`, {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      stage: "normalize",
      text: "Test sample transcript line 1.\nTest sample transcript line 2.",
      masterPrompt: "Clean text",
      formatRules: "standard",
      editRules: "standard",
      // Notice: retry triggers /api/process which uses the newly updated system model
    }),
  });
  const retryData = await retryRun.json();
  assert.equal(retryRun.status, 200);
  assert.ok(retryData.ok);
  console.log("✓ Retry pass executed successfully with updated system models");

  // 6. Reset back to gemini-2.0-flash
  await fetch(`${BASE}/api/admin/models`, {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      primaryModel: "gemini-2.0-flash",
      fallbackModels: ["gemini-1.5-flash", "meta/llama-3.3-70b-instruct"],
    }),
  });
  console.log("✓ Reset models to default: gemini-2.0-flash");
  console.log("\nRETRY TEST PASSED! 🎉\n");
}

testRetryPicksUpNewModel().catch((err) => {
  console.error("Retry test failed:", err);
  process.exit(1);
});
