import { NextRequest, NextResponse } from "next/server";
import { assertCanBookJob, getCurrentUser } from "../../../../lib/account";
import { databaseConfigured } from "../../../../lib/database";
import { deleteJob, getJob, saveJob } from "../../../../lib/jobs";
import { capToWords, countWords } from "../../../../lib/limits";
import { parseJobRecord } from "../../../../lib/types";
import { normalizeConfig } from "../../../../lib/workflow";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: { id: string } }) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: true, job: null, persistence: "browser", configured: false });
  }
  const job = await getJob(account.email, params.id);
  if (!job) return NextResponse.json({ ok: false, error: "That transcript was not found." }, { status: 404 });
  return NextResponse.json({ ok: true, job, persistence: "database", configured: true });
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const incoming = parseJobRecord({ ...body, id: params.id, ownerEmail: account.email });
    if (!incoming) return NextResponse.json({ ok: false, error: "The job payload was not valid." }, { status: 400 });
    let kind = incoming.kind === "job" ? "job" as const : "demo" as const;
    const gate = assertCanBookJob(account, kind);
    if (!gate.ok && kind === "job") kind = "demo";
    let source = incoming.source || "";
    if (kind === "demo") source = capToWords(source, account.demoWordCap).text;
    const existing = databaseConfigured() ? await getJob(account.email, params.id) : null;
    const job = {
      ...incoming,
      id: params.id,
      ownerEmail: account.email,
      kind,
      source,
      wordCount: countWords(source),
      createdAt: existing?.createdAt || incoming.createdAt,
      config: normalizeConfig({ ...incoming.config, transcript: source, sourceFileName: incoming.sourceFileName }),
    };
    const { persisted, error } = await saveJob(account.email, job);
    return NextResponse.json({ ok: true, job, persisted, configured: databaseConfigured(), ...(error ? { error } : {}) });
  } catch {
    return NextResponse.json({ ok: false, error: "The job could not be saved." }, { status: 400 });
  }
}

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  const { persisted, error } = await deleteJob(account.email, params.id);
  return NextResponse.json({ ok: true, persisted, configured: databaseConfigured(), ...(error ? { error } : {}) });
}
