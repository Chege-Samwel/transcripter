# Transcripter

Transcripter is a private editorial workspace for turning raw transcripts into clear, publishable edits without losing the source voice.

## Product flow

1. Sign in to the private workspace.
2. Paste a transcript or upload TXT, Markdown, or a ZIP containing `V.txt`.
3. Run the saved editorial direction through Normalize → Format → Edit.
4. Review the assembled output, run the section cross-check, and download TXT or PDF.
5. Change editorial direction and model routing in **Settings**, never in the intake screen.

Long sources are split into context-safe batches. Each batch receives one stage at a time, with continuity context kept separate from assembled output. A provider failure tries the configured alternatives in order and stops safely if all attempts fail.

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

Do not use the preview credentials in a deployed environment.

## Production configuration

Copy `.env.example` to your deployment environment. Required values:

- `SESSION_SECRET` — long random secret used to sign the HTTP-only session cookie.
- `AUTH_EMAIL` — the account email permitted to sign in.
- `AUTH_PASSWORD_HASH` — bcrypt hash for that account's password.
- `NVIDIA_API_KEY` — server-side NVIDIA API key.

`AUTH_PASSWORD` is supported for local setup, but a bcrypt hash is preferred in production. Generate one with any trusted bcrypt tool before deploying.

> **Local `.env` caveat:** Next.js interpolates `$`-references when loading `.env` files, which mangles bcrypt hashes (`$2b$10$…`). In a local `.env`, escape every dollar sign: `AUTH_PASSWORD_HASH=\$2b\$10\$…`. On Vercel/Render the env var is injected verbatim — store the plain hash there.

### Optional database persistence (Neon)

The app works with browser draft storage when no database is configured. For server persistence across devices:

1. Create a Neon Postgres database.
2. Set `DATABASE_URL` in the deployment environment (standard Postgres connection string; the pooled `-pooler` string works too).

That is all. The storage layer is a standard `pg` connection pool, and the schema in [`db/migrations/`](./db/migrations) is applied **automatically on first use** — there is no manual SQL step, so a fresh Neon database starts working immediately.

- `npm run db:migrate` — apply pending migrations manually (pre-provisioning, or after adding a migration). Safe to re-run.
- `npm run db:generate` — regenerate `lib/migrations.generated.ts` from the `.sql` files (also runs before `dev` and `build`); commit both files together.
- `npm run db:serve` — start a throwaway local Postgres for development without Docker.
- `DISABLE_AUTO_MIGRATE=1` — turn off runtime auto-migration (manual mode).
- `db/schema.sql` — full current schema for reference; migrations are the source of truth.

The authenticated user's workflow settings, latest output, and cross-check results are stored by email. Verify connectivity any time in **Settings → Storage** (or inspect the `database` field of `GET /api/workflow`). The browser remains a resilient draft cache if the database is temporarily unavailable.

## API boundaries

- `/api/auth/login`, `/api/auth/logout`, `/api/auth/session` manage the signed session.
- `/api/workflow` loads and saves the authenticated workflow, and reports database status in the `database` field (configured, applied migrations, errors).
- `/api/process` is authenticated and keeps the NVIDIA key on the server. It owns model fallback and context-window errors.

The middleware protects workspace, settings, workflow, and processing routes. Credentials and model keys are never sent to the client.
