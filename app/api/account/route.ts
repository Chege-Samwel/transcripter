import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/account";
import { databaseConfigured } from "../../../lib/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  return NextResponse.json({ ok: true, account, configured: databaseConfigured() });
}
