import { NextRequest, NextResponse } from "next/server";
import { clearCookieOptions, SESSION_COOKIE } from "../../../../lib/auth";

export async function POST(request: NextRequest) {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", clearCookieOptions(request));
  return response;
}
