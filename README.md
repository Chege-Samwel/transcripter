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

## Production configuration

Copy `.env.example` to your deployment environment. Required values:

- `SESSION_SECRET` — long random secret used to sign the HTTP-only session cookie.
- `AUTH_EMAIL` — bootstrap admin email (always permitted to sign in).
- `AUTH_PASSWORD_HASH` — bcrypt hash for that account's password.
- `NVIDIA_API_KEY` — server-side NVIDIA API key (optional; local preview transform is used without it).
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
- `/api/process` is authenticated, enforces the demo cap, retries model calls, and keeps the NVIDIA key on the server.
- `/api/workflow` still stores workspace-default guiding rules.
- `/api/health` is the Render/Vercel health check.

The middleware protects workspace, history, settings, admin, workflow, jobs, and processing routes. Credentials and model keys are never sent to the client.
