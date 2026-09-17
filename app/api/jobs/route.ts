import { NextRequest, NextResponse } from "next/server";
import { assertCanBookJob, getCurrentUser } from "../../../lib/account";
import { databaseConfigured } from "../../../lib/database";
import { listJobs, saveJob } from "../../../lib/jobs";
import { capToWords, countWords } from "../../../lib/limits";
import { createJobRecord, parseJobRecord } from "../../../lib/types";
import { normalizeConfig } from "../../../lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  const jobs = databaseConfigured() ? await listJobs(account.email) : [];
  return NextResponse.json({
    ok: true,
    jobs,
    persistence: account.persistence,
    configured: databaseConfigured(),
    account,
  });
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const parsed = parseJobRecord(body) || createJobRecord({
      ownerEmail: account.email,
      kind: body.kind === "job" ? "job" : "demo",
      config: body.config,
      source: typeof body.source === "string" ? body.source : "",
      sourceFileName: typeof body.sourceFileName === "string" ? body.sourceFileName : "",
      title: typeof body.title === "string" ? body.title : undefined,
    });
    let kind = parsed.kind === "job" ? "job" as const : "demo" as const;
    const gate = assertCanBookJob(account, kind);
    if (!gate.ok) {
      if (kind === "job") kind = "demo";
      else return NextResponse.json({ ok: false, error: gate.error, code: gate.code }, { status: gate.status });
    }
    let source = parsed.source || "";
    if (kind === "demo") {
      const capped = capToWords(source, account.demoWordCap);
      source = capped.text;
    }
    const job = {
      ...parsed,
      ownerEmail: account.email,
      kind,
      source,
      wordCount: countWords(source),
      config: normalizeConfig({ ...parsed.config, transcript: source, sourceFileName: parsed.sourceFileName }),
    };
    const { persisted, error } = await saveJob(account.email, job);
    return NextResponse.json({ ok: true, job, persisted, configured: databaseConfigured(), ...(error ? { error } : {}) });
  } catch {
    return NextResponse.json({ ok: false, error: "The job could not be created." }, { status: 400 });
  }
}
