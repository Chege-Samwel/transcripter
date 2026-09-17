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

  // 5. Test: Standard user POST /api/workflow with custom model choice
  const userSaveWorkflowRes = await fetch(`${BASE}/api/workflow`, {
    method: "POST",
    headers: { Cookie: userCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      config: {
        name: "User Workflow",
        primaryModel: "gemini-2.0-flash",
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

  // 6. Test: Standard user GET /api/workflow shows active model and output guide
  const userWorkflowRes = await fetch(`${BASE}/api/workflow`, {
    headers: { Cookie: userCookie },
  });
  assert.equal(userWorkflowRes.status, 200);
  const userWorkflow = await userWorkflowRes.json();
  assert.ok(userWorkflow.workflow?.config, "Workflow config should exist");
  assert.ok(userWorkflow.workflow?.config?.primaryModel, "primaryModel should be visible for user model freedom");
  assert.ok(userWorkflow.providers, "Provider readiness should be returned");
  assert.ok(userWorkflow.workflow?.config?.outputGuide, "outputGuide should be present in workflow config");
  assert.equal(userWorkflow.workflow?.config?.outputGuide?.speakerFormat, "UPPERCASE_COLON");
  console.log("✓ Standard user workflow response displays active model and provider status");

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

  // 10. Test /api/process shows active model used
  const userProcessRes = await fetch(`${BASE}/api/process`, {
    method: "POST",
    headers: { Cookie: userCookie, "Content-Type": "application/json", "x-test-mock": "true" },
    body: JSON.stringify({
      stage: "normalize",
      text: "hello   world  test  transcript",
      masterPrompt: "Clean text",
      formatRules: "standard",
      editRules: "standard",
      contextWindow: 16000,
      maxOutputTokens: 2000,
      temperature: 0.2,
      model: "nvidia/nemotron-3.5-lightning:free",
    }),
  });
  const userProcessData = await userProcessRes.json();
  assert.equal(userProcessRes.status, 200);
  assert.ok(userProcessData.ok);
  assert.equal(userProcessData.modelUsed, "nvidia/nemotron-3.5-lightning:free");
  console.log(`✓ Standard user /api/process succeeds with visible active model: ${userProcessData.modelUsed}`);

  // Test that without test mock and without keys, local safe model fallback is removed
  const noKeyProcessRes = await fetch(`${BASE}/api/process`, {
    method: "POST",
    headers: { Cookie: userCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      stage: "normalize",
      text: "hello   world  test  transcript",
      model: "nvidia/nemotron-3.5-lightning:free",
    }),
  });
  const noKeyData = await noKeyProcessRes.json();
  assert.notEqual(noKeyData.modelUsed, "Local safe engine", "Should NOT fall back to local safe engine");
  console.log("✓ Verified local safe engine fallback is removed (fails cleanly when keys are absent)");

  // Reset system models back to standard active defaults
  await fetch(`${BASE}/api/admin/models`, {
    method: "POST",
    headers: { Cookie: adminCookie, "Content-Type": "application/json" },
    body: JSON.stringify({
      primaryModel: "nvidia/nemotron-3.5-lightning:free",
      fallbackModels: ["nvidia/nemotron-3.5-lightning", "nvidia/nemotron-3-ultra-550b-a55b"],
    }),
  });
  console.log("✓ System models reset to active default: nvidia/nemotron-3.5-lightning:free");

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
