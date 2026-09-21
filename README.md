# Transcripter

Transcripter is a private editorial workspace for turning raw transcripts into clear, publishable edits without losing the source voice.

**Deploy:** Vercel + Neon is the recommended production setup. See [`DEPLOY.md`](./DEPLOY.md) for Vercel vs Render, every env var, and the approval workflow.

## Product flow

1. Open the site and **sign in** or **create an account**.
2. Registrations land as `awaiting_approval`. Those accounts can only run a **demo** (~600 words) — they cannot book a job.
3. An admin sets the status enum to `approved` under **Approvals**.
4. Navigate to **New transcript** or **History**.
5. Paste a source (or upload TXT / Markdown / ZIP with `V.txt`). Adjust guiding rules on the intake screen if this job needs a different contract.
6. Run a demo or, if approved, book a job. A **proceeding popup** shows live pass updates — not browser alerts.
7. If a pass fails: **Retry this pass** or **Continue later**. Partial batches are saved.
8. Open the **complete edits canvas**. Copy or paste Source, Normalized, Formatted, Edited, and any refine pass independently.
9. Request changes, start a new transcript, or reopen history. Workspace defaults live under **Guiding rules**.

Long sources are split into context-safe batches. Each batch receives one stage at a time, with continuity context kept separate from assembled output. A provider failure retries, then tries configured alternatives, then stops on the failed pass so you can continue.

## Templates, selection guards, and output guards

Workflow templates are the main templates: the one you select supplies the format rules, edit rules, master prompt, and Output Guide that every pass inherits.

**Selection guards** (`lib/template-guards.ts`)

- *Audit before use* — a template is `ready`, usable-with-warnings (`review`), or `blocked`. A blocked template (missing rules, master prompt, or Output Guide) is refused by the workspace picker, by Settings, and by `POST /api/templates`, instead of quietly degrading the editorial contract.
- *No silent erasure* — applying a template only copies non-empty fields; blank fields keep the rules currently in force, and the applied/kept split is reported in the notice.
- *Selection repair* — a stored `templateId` that no longer resolves (deleted, imported elsewhere, stale draft) is repaired to a real template, so the picker and the applied rules can never disagree.
- *Drift detection* — when the live rules diverge from the selected template, the workspace and Settings show exactly which fields drifted and offer a one-click restore of the template contract.

**Output guards** — each Output Guide check can carry a machine-checkable `expectation`: required `headers` in order, `numbered` items, `checklist` checkbox tokens, a `regex` that must match, an `absence` pattern that must not (placeholders, TODOs, summary language), `speakerLabels`, `maxWordsPerParagraph`, or `minLength`.

- Header guards are line-anchored but real-world tolerant: whitespace, markdown emphasis, list bullets, EMR `O:`/`S:` prefixes, numbering, and clinical shorthand (`Trauma Hx`, `ROS`, `MSE`, `Family Psych Hx`) all satisfy a required section, while prose that merely mentions the word does not. Aliases are declared per template and only ever attach to a header the template actually requires.
- The guide is compiled into a **delivery contract** that is injected into every `/api/process` prompt, so the model is constrained while it writes.
- The delivered text is then **audited after the pass**; `/api/process` returns `guideAudit`/`guideFlags`, the workspace surfaces failed checks on the running pass, and the canvas audit drawer shows each guard beside its verdict.
- The cross-check pass walks the template's own sections: with required headers declared, output is reviewed per section and every missing section is reported rather than skipped.
- Built-in templates ship armed guards (the psychiatric template guards all 7 of its checks, including a fabrication/placeholder guard).

The shipped `psychiatric-evaluation-template.workflow-template.json` export is generated from that same contract (`node --experimental-strip-types --import ./scripts/ts-resolve-register.mjs scripts/generate-psych-template.mjs`), so an exported template can never drift from the armed version.

The psychiatric template (`tpl-psychiatric-evaluation-master`) is written as a clinical contract: fixed section order and headers, `[Not documented]` for anything the source does not cover, strict psych/non-psych medication and allergy separation, a 10-field Mental Status Exam with rated insight and judgment, numbered Assessment, and the Psychotherapy Add-on checklist — all verified on delivery. The worked clinical example shipped with the template is the acceptance fixture: it scores 100% against the seven armed guards, both offline and through `POST /api/process`.

## Local development

```bash
npm install
npm run dev
```

The development server includes a local-only preview account when auth variables are not set:

```text
Email: editor@local.test
Password: local-preview-only
```

Do not use the preview credentials in a deployed environment. Preview access is treated as an approved admin so you can exercise the full canvas without a database.

Registration, approvals, and cross-device history need `DATABASE_URL` (Neon, or `npm run db:serve` for a throwaway local Postgres).

### Tests

```bash
npm run test:guards     # template selection guards + output guards (offline)
npm run test:deepseek   # DeepSeek provider routing against a local mock API
npm test                # both, then the end-to-end suites (needs a dev server on :3000)
```

To exercise the real `/api/process` guard path without a live model, run the app against the stand-in provider (it honours the injected delivery contract, so document-level guards are actually tested):

```bash
node scripts/mock-deepseek.mjs &
DEEPSEEK_API_KEY=sk-local-mock DEEPSEEK_BASE_URL=http://127.0.0.1:8787 npm run dev
```

## Production configuration

Copy `.env.example` to your deployment environment. Required values:

- `SESSION_SECRET` — long random secret used to sign the HTTP-only session cookie.
- `AUTH_EMAIL` — bootstrap admin email (always permitted to sign in).
- `AUTH_PASSWORD_HASH` — bcrypt hash for that account's password.
- `NVIDIA_API_KEY` — server-side NVIDIA API key (optional; local preview transform is used without it).
- `DEEPSEEK_API_KEY` — server-side DeepSeek key (optional; enables `deepseek-flash` / `deepseek-v4-pro`). Thinking mode is off by default for transcript latency — set `DEEPSEEK_THINKING=enabled` to use the reasoning path.
- `DATABASE_URL` — Postgres URL so registrations persist as `awaiting_approval` until approved.

`AUTH_PASSWORD` is supported for local setup, but a bcrypt hash is preferred in production.

> **Local `.env` caveat:** Next.js interpolates `$`-references when loading `.env` files, which mangles bcrypt hashes (`$2b$10$…`). In a local `.env`, escape every dollar sign: `AUTH_PASSWORD_HASH=\$2b\$10\$…`. On Vercel/Render the env var is injected verbatim — store the plain hash there.

### Optional database persistence (Neon)

The app works with browser draft storage when no database is configured. For server persistence across devices, registrations, and the approval enum:

1. Create a Neon Postgres database.
2. Set `DATABASE_URL` in the deployment environment (standard Postgres connection string; the pooled `-pooler` string works too).

The storage layer is a standard `pg` connection pool. Schema in [`db/migrations/`](./db/migrations) is applied **automatically on first use**.

- `npm run db:migrate` — apply pending migrations manually. Safe to re-run.
- `npm run db:generate` — regenerate `lib/migrations.generated.ts` from the `.sql` files; commit both files together.
- `npm run db:serve` — start a throwaway local Postgres for development without Docker.
- `DISABLE_AUTO_MIGRATE=1` — turn off runtime auto-migration.
- `DEMO_WORD_CAP` — demo wording cap (default 600).
- `db/schema.sql` — full current schema for reference; migrations are the source of truth.

## API boundaries

- `/api/auth/login`, `/api/auth/register`, `/api/auth/logout`, `/api/auth/session` manage the signed session and account status.
- `/api/jobs` stores transcript history, stages, resume cursors, and per-job error logs.
- `/api/admin/users` lets admins set `awaiting_approval` | `approved` | `suspended`.
- `/api/process` is authenticated, enforces the demo cap, injects the active template's delivery contract, retries model calls, audits the delivered text against the Output Guide, and keeps provider keys (NVIDIA, DeepSeek, OpenRouter, Google) on the server.
- `/api/templates` validates every saved template and returns a guard audit per template.
- `/api/workflow` still stores workspace-default guiding rules.
- `/api/health` is the Render/Vercel health check.

The middleware protects workspace, history, settings, admin, workflow, jobs, and processing routes. Credentials and model keys are never sent to the client.
