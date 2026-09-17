import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, listUsers, setUserStatus } from "../../../../lib/account";
import { databaseConfigured } from "../../../../lib/database";
import type { UserStatus } from "../../../../lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requireAdmin(account: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (account.role !== "admin") return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
  return null;
}

export async function GET() {
  const account = await getCurrentUser();
  const denied = requireAdmin(account);
  if (denied) return denied;
  if (!databaseConfigured()) {
    return NextResponse.json({
      ok: true,
      users: [],
      configured: false,
      message: "Set DATABASE_URL to review registrations. Until then, only the bootstrap admin can sign in.",
    });
  }
  const users = await listUsers();
  return NextResponse.json({ ok: true, users, configured: true });
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  const denied = requireAdmin(account);
  if (denied) return denied;
  if (!databaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Approvals require DATABASE_URL." }, { status: 503 });
  }
  try {
    const body = (await request.json()) as { email?: string; status?: UserStatus };
    const status = body.status;
    if (!body.email || !status || !["awaiting_approval", "approved", "suspended"].includes(status)) {
      return NextResponse.json({ ok: false, error: "Provide an email and a status enum: awaiting_approval, approved, or suspended." }, { status: 400 });
    }
    if (body.email === account!.email && status !== "approved") {
      return NextResponse.json({ ok: false, error: "You cannot change your own admin account away from approved." }, { status: 400 });
    }
    const result = await setUserStatus(body.email, status, account!.email);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
    const users = await listUsers();
    return NextResponse.json({ ok: true, users, status });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not update that account." }, { status: 400 });
  }
}
