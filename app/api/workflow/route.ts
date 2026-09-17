import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../lib/auth";
import { databaseConfigured, loadWorkflow, saveWorkflow } from "../../../lib/db";
import { databaseReadiness } from "../../../lib/migrate";
import { normalizeConfig, type SectionCheck, type WorkflowConfig } from "../../../lib/workflow";

export const runtime = "nodejs";

export async function GET() {
  const session = getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  const [workflow, database] = await Promise.all([loadWorkflow(session.email), databaseReadiness()]);
  return NextResponse.json({ ok: true, configured: databaseConfigured(), database, workflow });
}

export async function POST(request: NextRequest) {
  const session = getSession();
  if (!session) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  try {
    const body = (await request.json()) as { config?: unknown; result?: string; crossChecks?: SectionCheck[] };
    const config = normalizeConfig(body.config) as WorkflowConfig;
    const workflow = {
      config,
      result: typeof body.result === "string" ? body.result.slice(0, 2_000_000) : "",
      crossChecks: Array.isArray(body.crossChecks) ? body.crossChecks.slice(0, 500) : [],
    };
    const { persisted, error } = await saveWorkflow(session.email, workflow);
    return NextResponse.json({ ok: true, persisted, configured: databaseConfigured(), ...(error ? { error } : {}) });
  } catch {
    return NextResponse.json({ ok: false, error: "The workflow could not be saved." }, { status: 400 });
  }
}
