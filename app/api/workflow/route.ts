import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/account";
import { databaseConfigured, loadWorkflow, saveWorkflow } from "../../../lib/db";
import { databaseReadiness } from "../../../lib/migrate";
import { getSystemModels } from "../../../lib/system-settings";
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

  if (workflow?.config) {
    if (account.role !== "admin") {
      // Hide model information from regular users
      workflow.config = {
        ...workflow.config,
        primaryModel: "",
        fallbackModels: [],
      };
    } else {
      // Ensure admin sees active system models
      workflow.config.primaryModel = workflow.config.primaryModel || systemModels.primaryModel;
      workflow.config.fallbackModels = workflow.config.fallbackModels?.length ? workflow.config.fallbackModels : systemModels.fallbackModels;
    }
  }

  return NextResponse.json({ ok: true, configured: databaseConfigured(), database, workflow });
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  try {
    const body = (await request.json()) as { config?: unknown; result?: string; crossChecks?: SectionCheck[] };
    const config = normalizeConfig(body.config) as WorkflowConfig;

    if (account.role !== "admin") {
      // Regular users cannot adjust system models
      const systemModels = await getSystemModels();
      config.primaryModel = systemModels.primaryModel;
      config.fallbackModels = [...systemModels.fallbackModels];
    }

    const workflow = {
      config,
      result: typeof body.result === "string" ? body.result.slice(0, 2_000_000) : "",
      crossChecks: Array.isArray(body.crossChecks) ? body.crossChecks.slice(0, 500) : [],
    };
    const { persisted, error } = await saveWorkflow(account.email, workflow);
    return NextResponse.json({ ok: true, persisted, configured: databaseConfigured(), ...(error ? { error } : {}) });
  } catch {
    return NextResponse.json({ ok: false, error: "The workflow could not be saved." }, { status: 400 });
  }
}
