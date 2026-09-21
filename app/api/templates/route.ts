import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "../../../lib/account";
import { deleteTemplate, listTemplates, saveTemplate } from "../../../lib/templates";
import { auditTemplate, sanitizeTemplateInput } from "../../../lib/template-guards";
import { normalizeOutputGuide, type WorkflowTemplate } from "../../../lib/workflow";

export const runtime = "nodejs";

export async function GET() {
  const account = await getCurrentUser();
  const templates = await listTemplates(account?.email);
  // Templates travel with their guard audit so every surface (workspace picker,
  // settings library, imports) shows the same readiness verdict.
  const guards = Object.fromEntries(templates.map((template) => [template.id, auditTemplate(template)]));
  return NextResponse.json({ ok: true, templates, guards });
}

export async function POST(request: NextRequest) {
  const account = await getCurrentUser();
  if (!account) return NextResponse.json({ ok: false, error: "Authentication required." }, { status: 401 });

  try {
    const body = (await request.json()) as Partial<WorkflowTemplate>;
    const input = sanitizeTemplateInput(body);
    if (!input.name?.trim()) {
      return NextResponse.json({ ok: false, error: "Template name is required." }, { status: 400 });
    }

    // Selection guard: a template that would erase the editorial contract or
    // leave the output un-auditable is rejected before it reaches the library.
    const audit = auditTemplate({ ...input, outputGuide: normalizeOutputGuide(input.outputGuide) });
    if (!audit.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: `This template cannot be saved: ${audit.issues.filter((issue) => issue.level === "error").map((issue) => issue.message).join(" ")}`,
          code: "TEMPLATE_GUARD_BLOCKED",
          audit,
        },
        { status: 422 },
      );
    }

    const result = await saveTemplate(account.email, {
      ...input,
      outputGuide: normalizeOutputGuide(input.outputGuide),
    });

    return NextResponse.json({
      ok: true,
      template: result.template,
      audit,
      warnings: audit.issues.filter((issue) => issue.level === "warning"),
      message: audit.issues.length
        ? "Template saved to your workspace with guard warnings."
        : "Template saved to your workspace.",
    });
  } catch {
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
