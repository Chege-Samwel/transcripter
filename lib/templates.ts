import { databaseConfigured, describeDatabaseError, getPool } from "./database";
import { databaseReadiness } from "./migrate";
import { DEFAULT_TEMPLATES, makeId, normalizeOutputGuide, type WorkflowTemplate } from "./workflow";

const localTemplateCache = new Map<string, WorkflowTemplate[]>();

export function getStarterTemplates(): WorkflowTemplate[] {
  return DEFAULT_TEMPLATES.map((t) => ({ ...t, outputGuide: { ...t.outputGuide, checks: [...t.outputGuide.checks] } }));
}

export async function listTemplates(ownerEmail?: string): Promise<WorkflowTemplate[]> {
  const starters = getStarterTemplates();
  if (!ownerEmail) return starters;

  if (!databaseConfigured()) {
    const cached = localTemplateCache.get(ownerEmail) || [];
    return [...starters, ...cached];
  }

  const readiness = await databaseReadiness();
  if (readiness.error) {
    const cached = localTemplateCache.get(ownerEmail) || [];
    return [...starters, ...cached];
  }

  try {
    const client = await getPool().connect();
    try {
      const result = await client.query(
        "SELECT id, owner_email, name, description, category, config, is_default, created_at, updated_at FROM transcripter_workflow_templates WHERE owner_email = $1 OR owner_email IS NULL ORDER BY created_at ASC",
        [ownerEmail]
      );
      const customTemplates: WorkflowTemplate[] = result.rows.map((row) => {
        const cfg = typeof row.config === "string" ? JSON.parse(row.config) : row.config || {};
        return {
          id: row.id,
          ownerEmail: row.owner_email || undefined,
          name: row.name,
          description: row.description || "",
          category: row.category || "Custom",
          isDefault: Boolean(row.is_default),
          formatRules: typeof cfg.formatRules === "string" ? cfg.formatRules : "",
          editRules: typeof cfg.editRules === "string" ? cfg.editRules : "",
          masterPrompt: typeof cfg.masterPrompt === "string" ? cfg.masterPrompt : "",
          outputGuide: normalizeOutputGuide(cfg.outputGuide),
          sampleInput: typeof cfg.sampleInput === "string" ? cfg.sampleInput : undefined,
          sampleOutput: typeof cfg.sampleOutput === "string" ? cfg.sampleOutput : undefined,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
          updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
        };
      });

      // Merge starters and custom
      const starterIds = new Set(starters.map((s) => s.id));
      const filteredCustom = customTemplates.filter((c) => !starterIds.has(c.id));
      return [...starters, ...filteredCustom];
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Could not list templates from database", error);
    const cached = localTemplateCache.get(ownerEmail) || [];
    return [...starters, ...cached];
  }
}

export async function saveTemplate(
  ownerEmail: string,
  input: Partial<WorkflowTemplate>
): Promise<{ ok: boolean; template?: WorkflowTemplate; error?: string }> {
  const name = (input.name || "").trim() || "Custom Workflow Template";
  const id = input.id && input.id.startsWith("tpl-custom-") ? input.id : `tpl-custom-${makeId()}`;
  const now = new Date().toISOString();

  const template: WorkflowTemplate = {
    id,
    ownerEmail,
    name,
    description: (input.description || "").trim(),
    category: (input.category || "").trim() || "Custom",
    isDefault: false,
    formatRules: input.formatRules || "",
    editRules: input.editRules || "",
    masterPrompt: input.masterPrompt || "",
    outputGuide: normalizeOutputGuide(input.outputGuide),
    sampleInput: input.sampleInput || undefined,
    sampleOutput: input.sampleOutput || undefined,
    createdAt: input.createdAt || now,
    updatedAt: now,
  };

  const userTemplates = localTemplateCache.get(ownerEmail) || [];
  const existingIdx = userTemplates.findIndex((t) => t.id === id);
  if (existingIdx >= 0) {
    userTemplates[existingIdx] = template;
  } else {
    userTemplates.push(template);
  }
  localTemplateCache.set(ownerEmail, userTemplates);

  if (!databaseConfigured()) {
    return { ok: true, template };
  }

  const readiness = await databaseReadiness();
  if (readiness.error) {
    return { ok: true, template };
  }

  try {
    const client = await getPool().connect();
    try {
      const cfg = {
        formatRules: template.formatRules,
        editRules: template.editRules,
        masterPrompt: template.masterPrompt,
        outputGuide: template.outputGuide,
        sampleInput: template.sampleInput,
        sampleOutput: template.sampleOutput,
      };
      await client.query(
        `INSERT INTO transcripter_workflow_templates (id, owner_email, name, description, category, config, is_default, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, FALSE, NOW(), NOW())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           description = EXCLUDED.description,
           category = EXCLUDED.category,
           config = EXCLUDED.config,
           updated_at = NOW()`,
        [id, ownerEmail, name, template.description, template.category, JSON.stringify(cfg)]
      );
    } finally {
      client.release();
    }
    return { ok: true, template };
  } catch (error) {
    console.error("Could not save template to database", error);
    return { ok: true, template }; // Gracefully saved in local cache
  }
}

export async function deleteTemplate(
  ownerEmail: string,
  templateId: string
): Promise<{ ok: boolean; error?: string }> {
  const userTemplates = localTemplateCache.get(ownerEmail) || [];
  localTemplateCache.set(
    ownerEmail,
    userTemplates.filter((t) => t.id !== templateId)
  );

  if (!databaseConfigured()) {
    return { ok: true };
  }

  try {
    const client = await getPool().connect();
    try {
      await client.query(
        "DELETE FROM transcripter_workflow_templates WHERE id = $1 AND owner_email = $2",
        [templateId, ownerEmail]
      );
    } finally {
      client.release();
    }
    return { ok: true };
  } catch (error) {
    console.error("Could not delete template from database", error);
    return { ok: false, error: describeDatabaseError(error) };
  }
}
