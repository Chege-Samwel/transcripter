import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { authConfiguration, createSessionToken, sessionCookieOptions, normalizeEmail } from "../../../../lib/auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { email?: string; password?: string };
    const email = normalizeEmail(body.email || "");
    const password = body.password || "";
    const credentials = authConfiguration();

    if (!credentials.email || (!credentials.passwordHash && !credentials.password)) {
      return NextResponse.json({ ok: false, error: "Authentication is not configured for this workspace." }, { status: 503 });
    }
    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Enter your email and password." }, { status: 400 });
    }

    const emailMatches = credentials.email && email === credentials.email;
    const passwordMatches = credentials.passwordHash
      ? await bcrypt.compare(password, credentials.passwordHash)
      : Boolean(credentials.password && password === credentials.password);

    if (!emailMatches || !passwordMatches) {
      return NextResponse.json({ ok: false, error: "Those credentials do not match an active account." }, { status: 401 });
    }

    const response = NextResponse.json({ ok: true, email });
    response.cookies.set("transcripter_session", createSessionToken(email), sessionCookieOptions(request));
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Authentication is not configured.";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
