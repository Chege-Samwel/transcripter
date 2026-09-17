import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/account";
import { deleteTemplate, listTemplates, saveTemplate } from "../../../lib/templates";
import { normalizeOutputGuide, type WorkflowTemplate } from "../../../lib/workflow";

export const runtime = "nodejs";

export async function GET() {
  const account = await getCurrentUser();
  const templates = await listTemplates(account?.email);
  return NextResponse.json({ ok: true, templates });
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  try {
    const body = (await request.json()) as Partial<WorkflowTemplate>;
    if (!body.name?.trim()) {
      return NextResponse.json({ ok: false, error: "Template name is required." }, { status: 400 });
    }

    const result = await saveTemplate(account.email, {
      ...body,
      outputGuide: normalizeOutputGuide(body.outputGuide),
    });

    return NextResponse.json({ ok: true, template: result.template, message: "Template saved to your workspace." });
  } catch (error) {
    return NextResponse.json({ ok: false, error: "Could not save template." }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ ok: false, error: "Template ID is required." }, { status: 400 });

    const result = await deleteTemplate(account.email, id);
    return NextResponse.json({ ok: result.ok, error: result.error });
  } catch {
    return NextResponse.json({ ok: false, error: "Could not delete template." }, { status: 400 });
  }
}
