import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../../lib/account";
import { getSystemModels, saveSystemModels } from "../../../../lib/system-settings";
import { MODEL_OPTIONS } from "../../../../lib/workflow";

export const runtime = "nodejs";

function requireAdmin(account: Awaited<ReturnType<typeof getCurrentUser>>) {
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });
  if (account.role !== "admin") return NextResponse.json({ ok: false, error: "Admin access required. Models can only be viewed and configured by administrators." }, { status: 403 });
  return null;
}

export async function GET() {
  const account = await getCurrentUser();
  const denied = requireAdmin(account);
  if (denied) return denied;

  const models = await getSystemModels();
  return NextResponse.json({ ok: true, models, modelOptions: MODEL_OPTIONS });
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  const denied = requireAdmin(account);
  if (denied) return denied;

  try {
    const body = (await request.json()) as { primaryModel?: string; fallbackModels?: string[] };
    const primary = typeof body.primaryModel === "string" ? body.primaryModel.trim() : "";
    const fallbacks = Array.isArray(body.fallbackModels)
      ? body.fallbackModels.filter((m): m is string => typeof m === "string" && m.trim().length > 0)
      : [];

    if (!primary) {
      return NextResponse.json({ ok: false, error: "A primary model is required." }, { status: 400 });
    }

    const result = await saveSystemModels(primary, fallbacks, account!.email);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error || "Could not save system models." }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      message: "System models updated successfully for everyone.",
      models: result.models,
    });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Invalid request payload." }, { status: 400 });
  }
}
