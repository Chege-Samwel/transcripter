import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/account";
import { logError } from "../../../lib/errors";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  try {
    const body = (await request.json()) as {
      jobId?: string;
      stage?: string;
      batch?: number;
      code?: string;
      message?: string;
      detail?: unknown;
    };
    if (!body.message?.trim()) return NextResponse.json({ ok: false, error: "A message is required." }, { status: 400 });
    await logError({
      ownerEmail: account.email,
      jobId: body.jobId,
      stage: body.stage,
      batch: body.batch,
      code: body.code,
      message: body.message.trim(),
      detail: body.detail,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not record the error." }, { status: 400 });
  }
}
