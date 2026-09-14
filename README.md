# Transcripter Workflow Studio

A Vercel-ready Next.js app for turning raw transcripts into a traceable, batch-safe edited version. The workflow stores the source, editorial rules, master prompt, model routing, context limits, latest output, and cross-check results as one portable JSON file.

## What is included

- Transcript input with editable source, TXT/MD upload, and ZIP intake that looks for `V.txt` first.
- Persistent workflow fields using browser draft storage, plus import/export JSON and a share link that pre-fills the full workflow.
- Explicit Normalize → Format → Edit pipeline. Each stage sends one batch to one process at a time.
- Context-aware batch planner with estimated tokens, configurable target batch size, overlap continuity context, and max output tokens.
- NVIDIA-compatible OpenAI chat-completions route with ordered fallback models and clear failure tracing.
- Local safe preview mode when `NVIDIA_API_KEY` is not configured, so the UI can be previewed without credentials.
- Execution timeline with batch, stage, model, fallback, demo, duration, and error status.
- Full output display with TXT/PDF downloads, clipboard copy, and a deterministic cross-check for unresolved markers, repeated words, and punctuation issues.

## Run locally

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

To use NVIDIA inference, create `.env.local` (never commit it):

```bash
NVIDIA_API_KEY=your_key_here
```

The server route calls `https://integrate.api.nvidia.com/v1/chat/completions`. The key is read only inside `app/api/process/route.ts` and is never sent to the browser.

## Deploy to Vercel

Import the repository into Vercel and add `NVIDIA_API_KEY` under **Project Settings → Environment Variables**. Vercel detects the Next.js framework automatically. The included `vercel.json` keeps the deployment in the `iad1` region.

## Workflow handoffs

- **Export JSON** contains the transcript and every editable field, routing choice, output, and cross-check result.
- **Import JSON** restores those values without asking the recipient to re-enter the form.
- **Share workflow** copies a URL containing the same payload. For very long transcripts, use the JSON export because URLs can become unwieldy.
- Browser draft storage is local to the current browser. Use Export JSON for durable or team handoffs.

## Model and error behavior

The client plans batches before any model call. For each batch it runs the three stages sequentially. The API route estimates prompt tokens against the configured context window and returns a clear `CONTEXT_LIMIT` error rather than silently truncating. If NVIDIA returns an error, the route tries the primary model and then each non-empty fallback in order; all attempts are included in the trace response. A failed stage stops final assembly so partial output cannot be mistaken for a complete edit.
