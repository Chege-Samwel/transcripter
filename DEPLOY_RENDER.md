# Deploying Transcripter Studio to Render

Render is an ideal persistent backend for Transcripter because **Render web services do not suffer from the 10-second serverless execution limits** of Vercel. Long transcript batches (30s, 60s, or minutes) can run to completion without any `504 Gateway Timeout`.

---

## 1. Quick Deploy via Blueprint (`render.yaml`)

1. Push your changes to GitHub or merge your Pull Request to `main`.
2. In the [Render Dashboard](https://dashboard.render.com/):
   - Click **New +** > **Blueprint**.
   - Select your `transcripter` repository.
   - Render will detect `render.yaml` and configure the Web Service automatically.
3. Add the required Environment Variables:
   - `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) from [Google AI Studio](https://aistudio.google.com/app/apikey).
   - `DATABASE_URL` (your Neon, Supabase, or Render PostgreSQL database URL).
   - `AUTH_EMAIL` (your admin email).
   - `AUTH_PASSWORD_HASH` (bcrypt hash of your admin password).
4. Click **Apply**. Render will run:
   - `buildCommand`: `npm install && npm run build`
   - `startCommand`: `npm run start`

---

## 2. Setting Up Google AI Studio (Recommended Primary)

1. Go to [Google AI Studio](https://aistudio.google.com/app/apikey) and generate a free API key.
2. In your Render (or Vercel) environment variables, add:
   - `GEMINI_API_KEY`: `AIzaSy...`
3. Active supported models:
   - `gemini-2.0-flash`: **Ultra-fast (~1-2s response time)**, 1M context window, highly accurate formatting.
   - `gemini-2.5-flash`: Latest Google flash reasoning model.
   - `gemini-1.5-flash`: High capacity, stable 1M context.
   - `gemini-1.5-pro`: Deep editorial reasoning for complex jargon and multi-speaker audio.

---

## 3. Setting Up NVIDIA NIM (Optional / Redundant)

1. Obtain your key from [NVIDIA build](https://build.nvidia.com/).
2. In your environment variables, add:
   - `NVIDIA_API_KEY`: `nvapi-...`
3. Active supported models:
   - `meta/llama-3.3-70b-instruct`
   - `nvidia/llama-3.1-nemotron-70b-instruct`
   - `meta/llama-3.1-8b-instruct`

---

## 4. Automatic Multi-Provider Fallback

If both `GEMINI_API_KEY` and `NVIDIA_API_KEY` are configured:
- Transcripter allows you to pick any model directly from the workspace.
- If an external model is rate-limited or fails, the pipeline automatically falls back to alternative models across providers.
- If all external APIs fail or time out, the resilient local engine finishes the pass so jobs never halt with 502/504 errors.
