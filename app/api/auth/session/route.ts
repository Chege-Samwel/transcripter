import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/auth";

export async function GET() {
  const session = getSession();
  return NextResponse.json({ authenticated: Boolean(session), email: session?.email || null });
}
