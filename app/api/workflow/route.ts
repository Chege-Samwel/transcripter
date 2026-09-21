import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/account";
import { databaseConfigured, loadWorkflow, saveWorkflow } from "../../../lib/db";
import { databaseReadiness } from "../../../lib/migrate";
import { getSystemModels } from "../../../lib/system-settings";
import { getProviderStatus } from "../../../lib/ai-providers";
import { normalizeConfig, type SectionCheck, type WorkflowConfig } from "../../../lib/workflow";

export const runtime = "nodejs";

export async function GET() {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  const [workflow, database, systemModels] = await Promise.all([
    loadWorkflow(account.email),
    databaseReadiness(),
    getSystemModels(),
  ]);

  const providers = getProviderStatus();

  if (workflow?.config) {
    workflow.config.primaryModel = workflow.config.primaryModel || systemModels.primaryModel;
    workflow.config.fallbackModels = workflow.config.fallbackModels?.length
      ? workflow.config.fallbackModels
      : systemModels.fallbackModels;
  }

  return NextResponse.json({
    ok: true,
    configured: databaseConfigured(),
    database,
    workflow,
    systemModels,
    providers,
  });
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  try {
    const body = (await request.json()) as {
      config?: unknown;
      result?: string;
      crossChecks?: SectionCheck[];
    };

    // Partial saves: the workspace persists the selected main template and its
    // contract without clobbering a result that Settings (or a previous run)
    // already stored, and Settings can save a result without rewriting config.
    const existing = await loadWorkflow(account.email);
    const hasConfig = body.config !== undefined && body.config !== null;
    const hasResult = typeof body.result === "string" || Array.isArray(body.crossChecks);

    // A partial config (the workspace persists the template selection only) is
    // merged over the stored config so untouched fields — model choice, batch
    // sizes, rules on another tab — are never reset to defaults.
    const config = hasConfig
      ? (normalizeConfig({ ...((existing?.config as Record<string, unknown>) || {}), ...(body.config as Record<string, unknown>) }) as WorkflowConfig)
      : ((existing?.config as WorkflowConfig) || (normalizeConfig(undefined) as WorkflowConfig));

    const workflow = {
      config,
      result: typeof body.result === "string" ? body.result.slice(0, 2_000_000) : existing?.result || "",
      crossChecks: Array.isArray(body.crossChecks)
        ? body.crossChecks.slice(0, 500)
        : existing?.crossChecks || [],
    };

    if (!hasConfig && !hasResult) {
      return NextResponse.json({ ok: false, error: "Nothing to save." }, { status: 400 });
    }

    const { persisted, error } = await saveWorkflow(account.email, workflow);
    return NextResponse.json({ ok: true, persisted, configured: databaseConfigured(), ...(error ? { error } : {}) });
  } catch {
    return NextResponse.json({ ok: false, error: "The workflow could not be saved." }, { status: 400 });
  }
}
