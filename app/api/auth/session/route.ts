import { NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/account";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const account = await getCurrentUser();
  return NextResponse.json({ authenticated: Boolean(account), email: account?.email || null, account });
}
