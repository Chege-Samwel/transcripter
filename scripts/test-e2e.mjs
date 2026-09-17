// scripts/test-e2e.mjs
import assert from "node:assert/strict";

const BASE = "http://127.0.0.1:3000";

async function run() {
  console.log("=== Running Transcripter Studio E2E Verification ===");

  // Helper for requests with cookie jar
  let userCookie = "";
  let adminCookie = "";

  // 1. Health check
  const healthRes = await fetch(`${BASE}/api/health`);
  const health = await healthRes.json();
  assert.equal(healthRes.status, 200);
  assert.equal(health.ok, true);
  console.log("✓ Health check OK");

  // 2. Register standard user
  const userEmail = `user-${Date.now()}@test.com`;
  const userRegRes = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: userEmail, password: "password123", displayName: "Standard User" }),
  });
  const userReg = await userRegRes.json();
  assert.equal(userRegRes.status, 200, "Register user should succeed");
  assert.equal(userReg.account?.role, "editor");
  userCookie = userRegRes.headers.get("set-cookie") || "";
  console.log("✓ Standard user registered with role 'editor' (non-admin)");

  // 3. Register or login bootstrap admin user (matching AUTH_EMAIL=admin@example.com)
  const adminEmail = "admin@example.com";
  let adminRegRes = await fetch(`${BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password: "password123", displayName: "Admin User" }),
  });
  if (adminRegRes.status === 409) {
    adminRegRes = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adminEmail, password: "password123" }),
    });
  }
  const adminReg = await adminRegRes.json();
  assert.equal(adminRegRes.status, 200, "Register/login admin should succeed");
  assert.equal(adminReg.account?.role, "admin");
  adminCookie = adminRegRes.headers.get("set-cookie") || "";
  console.log("✓ Admin user authenticated with role 'admin'");

  // 4. Test: Standard user CANNOT access /api/admin/models (403)
  const userAdminModelsGet = await fetch(`${BASE}/api/admin/models`, {
    headers: { Cookie: userCookie },
  });
  assert.equal(userAdminModelsGet.status, 403, "Non-admin should get 403 on GET /api/admin/models");

  const userAdminModelsPost = await fetch(`${BASE}/api/admin/models`, {
    method: "POST",
    headers: { Cookie: userCookie, "Content-Type": "application/json" },
    body: JSON.stringify({ primaryModel: "hacked/model", fallbackModels: [] }),
  });
  assert.equal(userAdminModelsPost.status, 403, "Non-admin should get 403 on POST /api/admin/models");
  console.log("✓ Standard user is completely blocked from /api/admin/models (GET & POST 403)");

  // 5. Test: Standard user POST /api/workflow ignores any attempt to inject custom models
  const userSaveWorkflowRes = await fetch(`${BASE}/api/workflow`, {
    method: "POST",
    headers: { Cookie: userCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      config: {
        name: "User Workflow",
        primaryModel: "unauthorized/model",
        fallbackModels: ["evil/fallback"],
        outputGuide: {
          speakerLabels: true,
          speakerFormat: "UPPERCASE_COLON",
          maxParagraphSentences: 4,
          disallowInaudibleTags: true,
          requireTimestamps: false,
          forbiddenTerms: ["secret"],
        },
      },
    }),
  });
  assert.equal(userSaveWorkflowRes.status, 200);
  console.log("✓ Standard user POST /api/workflow succeeded");

  // 6. Test: Standard user GET /api/workflow strips model information
  const userWorkflowRes = await fetch(`${BASE}/api/workflow`, {
    headers: { Cookie: userCookie },
  });
  assert.equal(userWorkflowRes.status, 200);
  const userWorkflow = await userWorkflowRes.json();
  assert.ok(userWorkflow.workflow?.config, "Workflow config should exist");
  assert.equal(userWorkflow.workflow?.config?.primaryModel, "", "primaryModel must be stripped for standard users");
  assert.deepEqual(userWorkflow.workflow?.config?.fallbackModels, [], "fallbackModels must be stripped for standard users");
  assert.ok(userWorkflow.workflow?.config?.outputGuide, "outputGuide should be present in workflow config");
  assert.equal(userWorkflow.workflow?.config?.outputGuide?.speakerFormat, "UPPERCASE_COLON");
  console.log("✓ Standard user workflow response hides primaryModel and fallbackModels");

  // 7. Test: Admin GET /api/admin/models succeeds and returns active system models
  const adminModelsGet = await fetch(`${BASE}/api/admin/models`, {
    headers: { Cookie: adminCookie },
  });
  assert.equal(adminModelsGet.status, 200);
  const adminModelsData = await adminModelsGet.json();
  assert.equal(adminModelsData.ok, true);
  assert.ok(adminModelsData.models?.primaryModel);
  console.log(`✓ Admin can view system models: Primary=${adminModelsData.models.primaryModel}, Fallbacks=${adminModelsData.models.fallbackModels.join(", ")}`);

  // 8. Test: Admin updates system models via POST /api/admin/models
  const updatedPrimary = "nvidia/llama-3.1-nemotron-70b-instruct";
  const updatedFallbacks = ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-8b-instruct"];
  const adminSaveModelsRes = await fetch(`${BASE}/api/admin/models`, {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      primaryModel: updatedPrimary,
      fallbackModels: updatedFallbacks,
    }),
  });
  assert.equal(adminSaveModelsRes.status, 200);
  const adminSaveResult = await adminSaveModelsRes.json();
  assert.equal(adminSaveResult.ok, true);
  assert.equal(adminSaveResult.models?.primaryModel, updatedPrimary);
  assert.deepEqual(adminSaveResult.models?.fallbackModels, updatedFallbacks);
  console.log("✓ Admin successfully updated system models for everyone");

  // Verify the system models persisted and are returned to admin
  const verifyAdminModels = await fetch(`${BASE}/api/admin/models`, {
    headers: { Cookie: adminCookie },
  });
  const verifyData = await verifyAdminModels.json();
  assert.equal(verifyData.models?.primaryModel, updatedPrimary);
  assert.deepEqual(verifyData.models?.fallbackModels, updatedFallbacks);
  console.log("✓ System models persisted in database and verified");

  // 9. Test: Templates API (/api/templates)
  const templatesGet = await fetch(`${BASE}/api/templates`, {
    headers: { Cookie: userCookie },
  });
  assert.equal(templatesGet.status, 200);
  const templatesData = await templatesGet.json();
  assert.ok(templatesData.ok);
  assert.ok(Array.isArray(templatesData.templates));
  assert.ok(templatesData.templates.length >= 3, "Should include default templates");
  const firstDefault = templatesData.templates[0];
  assert.ok(firstDefault.name);
  assert.ok(firstDefault.formatRules);
  assert.ok(firstDefault.editRules);
  assert.ok(firstDefault.masterPrompt);
  assert.ok(firstDefault.outputGuide);
  console.log(`✓ GET /api/templates returned ${templatesData.templates.length} templates with rules and output guides`);

  // Create custom template as user
  const customTemplateId = `tpl-${Date.now()}`;
  const createTplRes = await fetch(`${BASE}/api/templates`, {
    method: "POST",
    headers: { Cookie: userCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      id: customTemplateId,
      name: "Podcast Interview Master",
      description: "Custom template with speaker formatting and strict quality checks",
      formatRules: "Format as dialogue with UPPERCASE_COLON speaker labels.",
      editRules: "Clean filler words (um, uh). Preserve terminology.",
      masterPrompt: "You are an elite transcript editor for broadcast media.",
      outputGuide: {
        speakerLabels: true,
        speakerFormat: "UPPERCASE_COLON",
        requireTimestamps: false,
        disallowInaudibleTags: true,
        maxParagraphSentences: 3,
        forbiddenTerms: ["inaudible", "placeholder"],
      },
      isDefault: false,
    }),
  });
  assert.equal(createTplRes.status, 200);
  const createdTplData = await createTplRes.json();
  assert.equal(createdTplData.ok, true);
  assert.equal(createdTplData.template?.name, "Podcast Interview Master");
  console.log("✓ Created custom workflow template with rules, guides, and output guide");

  // Verify custom template appears in templates list
  const templatesAfterCreate = await fetch(`${BASE}/api/templates`, {
    headers: { Cookie: userCookie },
  });
  const afterData = await templatesAfterCreate.json();
  const savedId = createdTplData.template?.id;
  const foundCustom = afterData.templates.find((t) => t.id === savedId || t.name === "Podcast Interview Master");
  assert.ok(foundCustom, "Custom template should appear in templates list");
  assert.equal(foundCustom.name, "Podcast Interview Master");
  assert.equal(foundCustom.outputGuide?.speakerFormat, "UPPERCASE_COLON");
  console.log("✓ Verified custom template is present and importable with complete outputGuide");

  // Delete custom template
  const deleteTplRes = await fetch(`${BASE}/api/templates?id=${savedId}`, {
    method: "DELETE",
    headers: { Cookie: userCookie },
  });
  assert.equal(deleteTplRes.status, 200);
  console.log("✓ Successfully deleted custom template");

  // 10. Test /api/process security and behavior
  const userProcessRes = await fetch(`${BASE}/api/process`, {
    method: "POST",
    headers: { Cookie: userCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      stage: "normalize",
      text: "hello   world  test  transcript",
      masterPrompt: "Clean text",
      formatRules: "standard",
      editRules: "standard",
      contextWindow: 16000,
      maxOutputTokens: 2000,
      temperature: 0.2,
      // User attempts to inject custom model:
      model: "malicious/injected-model",
      fallbackModels: ["malicious/fallback"],
    }),
  });
  const userProcessData = await userProcessRes.json();
  assert.equal(userProcessRes.status, 200);
  assert.ok(userProcessData.ok);
  assert.equal(userProcessData.modelUsed, undefined, "Non-admin response must NOT expose modelUsed");
  assert.equal(userProcessData.fallbackUsed, undefined, "Non-admin response must NOT expose fallbackUsed");
  console.log("✓ Standard user /api/process succeeds without leaking model information");

  // Reset system models back to standard active defaults
  await fetch(`${BASE}/api/admin/models`, {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      primaryModel: "meta/llama-3.1-8b-instruct",
      fallbackModels: ["meta/llama-3.2-3b-instruct", "nvidia/llama-3.1-nemotron-70b-instruct"],
    }),
  });
  console.log("✓ System models reset to active default: meta/llama-3.1-8b-instruct");

  // 11. Test Settings page HTML does NOT contain "Where work is saved" or "STORAGE"
  const settingsHtmlRes = await fetch(`${BASE}/settings`, {
    headers: { Cookie: userCookie },
  });
  const settingsHtml = await settingsHtmlRes.text();
  assert.ok(!settingsHtml.includes("Where work is saved"), "Storage explanation section should not be in HTML");
  assert.ok(!settingsHtml.includes("Schema migrations apply automatically"), "Storage technical copy should not be in HTML");
  console.log("✓ Verified Settings page does not contain unnecessary storage technical section");

  console.log("\nALL E2E INTEGRATION TESTS PASSED SUCCESSFULLY! 🎉\n");
}

run().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
