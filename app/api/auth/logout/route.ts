import { NextResponse } from "next/server";
import { clearCookieOptions, SESSION_COOKIE } from "../../../../lib/auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", clearCookieOptions());
  return response;
}
