# Deploy Transcripter

**Use Vercel + Neon.** Render works, but Vercel is the better fit for this app.

## Why Vercel wins here

The editor is a Next.js App Router app. Each NVIDIA (or local demo) pass is a short `/api/process` call. The browser orchestrates batches, retries, and continuation, so a 60-second serverless limit is enough.

| | Vercel | Render |
| --- | --- | --- |
| Next.js | Native, zero-config | Node web service you start yourself |
| Previews | Every push gets a URL | Manual |
| Env UI | First-class, per environment | Fine, less convenient |
| Long requests | 60s Hobby / 300s Pro — enough because batches are client-driven | No function timeout |
| Postgres | Pair with Neon (pooled URL) | Render Postgres, or Neon |
| Cold start | Typical serverless | Always-on instance costs more |

Pick **Render** only if you want a single always-on Node process plus Render Postgres in one dashboard.

---

## 1. Vercel (recommended)

1. Push this repo to GitHub.
2. [vercel.com/new](https://vercel.com/new) → import the repo. Framework preset: **Next.js**. `vercel.json` already pins `iad1`.
3. Create a Neon project → copy the **pooled** connection string (`-pooler` + `?sslmode=require`).
4. In Vercel → Settings → Environment Variables, add the values below to Production (and Preview if you want logins there).
5. Deploy. Schema migrations apply automatically on first use.
6. Sign in with `AUTH_EMAIL`. That account is upserted as **admin / approved**.
7. Open **Approvals** and set registrations from `awaiting_approval` → `approved` when they should book full jobs.

```bash
npx vercel --prod
```

---

## 2. Render (alternative)

`render.yaml` is included.

1. New → Blueprint → this repo, or a Web Service:
   - **Build:** `npm install && npm run build`
   - **Start:** `npm run start`
   - **Health:** `/api/health`
   - Node 20
2. Add a Render Postgres instance, or point `DATABASE_URL` at Neon.
3. Set the same env vars as Vercel.
4. Deploy. First request applies migrations.

Render Web Services do not run Next.js the Vercel way — they run `next start` on one instance. That is fine, just slower to iterate.

---

## Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `SESSION_SECRET` | Production | Long random secret for the HTTP-only session cookie. |
| `AUTH_EMAIL` | Production | Bootstrap admin email. Can always sign in; upserted as `approved` + `admin`. |
| `AUTH_PASSWORD_HASH` | Production | bcrypt hash of that admin password. |
| `AUTH_PASSWORD` | Local only | Plain password fallback. Do not use in production. |
| `NVIDIA_API_KEY` | For real model passes | Server-side NVIDIA NIM key. If unset, batches use the local preview transform. |
| `NVIDIA_NIM_API_KEY` | Optional alias | Same as `NVIDIA_API_KEY`. |
| `DATABASE_URL` | For registrations, approvals, history across devices | Standard Postgres URL (Neon pooled is ideal). |
| `DISABLE_AUTO_MIGRATE` | Optional | `1` to apply schema only via `npm run db:migrate`. |
| `DEMO_WORD_CAP` | Optional | Demo word cap. Default **600**. |

Generate a hash before production:

```bash
node -e "require('bcryptjs').hash('your-password', 12).then(console.log)"
```

**Local `.env` caveat:** Next.js interpolates `$` in `.env` files and will mangle bcrypt hashes. Escape every dollar: `AUTH_PASSWORD_HASH=\$2b\$12\$...`. Vercel and Render inject env vars verbatim — store the plain hash there.

**Never** expose `NVIDIA_API_KEY`, `SESSION_SECRET`, or `DATABASE_URL` to the browser. They stay on the server.

---

## Account enums

Postgres enums (migration `0002`):

- `user_status`: `awaiting_approval` · `approved` · `suspended`
- `user_role`: `editor` · `admin`
- `job_kind`: `demo` · `job`
- `job_status`: `draft` · `running` · `paused` · `complete` · `failed`

New registrations insert as `awaiting_approval`. They can sign in and run a **demo** capped at ~600 words. They **cannot book a job** until an admin sets `approved`.

---

## After deploy — smoke path

1. Open the site → **Create an account** (or sign in as `AUTH_EMAIL`).
2. New transcript → paste source → Demo → proceeding popup (not an alert).
3. Canvas: copy/paste Source, Normalized, Formatted, Edited.
4. Request changes → refine pass.
5. History → reopen or continue a failed run.
6. Admin: Approvals → `approved` → that user can book a job.

---

## Troubleshooting

- **Session cookie not accepted** on a preview host: HTTPS + `SameSite=None` is already set for `*.vercel.app` / `*.e2b.app`.
- **Database not ready:** check `DATABASE_URL` and `/api/health`. Migrations retry on the next request.
- **NVIDIA 401:** the key belongs in Vercel/Render env, not in the client.
- **Demo only:** the account is still `awaiting_approval`. Approve it in **Approvals**.
- **`/api/process` returns 502:** the model chain ran and every model refused. This is the
  route's own response, not a Vercel error — the JSON body lists the reason per model in
  `attempts[]` (bad key, unknown model id, rate limit). The console only shows the status
  line, so read the response body or the logged `MODEL_FAILURE` event.
- **`/api/process` returns 504 with `code: "TIMEOUT"`:** the fan-out ran out of the
  function's time budget and stopped itself, so you get an explanation instead of Vercel's
  bodyless gateway timeout. Lower the batch size in Settings, or raise `maxDuration` in
  `app/api/process/route.ts` **and** the project's function max duration in Vercel — the
  in-route budget is derived from that constant, so both have to move together. Hobby caps
  out at 60s; Pro allows 300s.
- **A bodyless 504 (no JSON at all):** the invocation was killed by the platform. That means
  something ran past `maxDuration` without the route's own budget guard catching it.
