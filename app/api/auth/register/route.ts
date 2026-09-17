import { NextRequest, NextResponse } from "next/server";
import { createRegisteredUser } from "../../../../lib/account";
import { createSessionToken, sessionCookieOptions } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { email?: string; password?: string; displayName?: string };
    const result = await createRegisteredUser({
      email: body.email || "",
      password: body.password || "",
      displayName: body.displayName,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    const response = NextResponse.json({
      ok: true,
      account: result.account,
      message: result.account.canBookJob
        ? "Workspace ready."
        : `You're in as a demo editor. An admin has to set your status to approved before you can book a full job. Until then, runs are capped at ${result.account.demoWordCap} words.`,
    });
    response.cookies.set("transcripter_session", createSessionToken(result.account.email), sessionCookieOptions(request));
    return response;
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Could not register." },
      { status: 500 },
    );
  }
}
