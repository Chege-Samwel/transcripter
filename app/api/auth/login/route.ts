import { NextRequest, NextResponse } from "next/server";
import { verifyLogin } from "../../../../lib/account";
import { createSessionToken, sessionCookieOptions, normalizeEmail } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = normalizeEmail(body.email || "");
    const password = body.password || "";
    const result = await verifyLogin(email, password);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    const response = NextResponse.json({ ok: true, email: result.account.email, account: result.account });
    response.cookies.set("transcripter_session", createSessionToken(result.account.email), sessionCookieOptions(request));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication is not configured.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
