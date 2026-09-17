# Deploying Transcripter Studio to Render

Render is an ideal persistent backend for Transcripter because **Render web services do not suffer from the serverless execution limits** of conventional serverless hosts. Long transcript batches (30s, 60s, or minutes) can run to completion smoothly.

---

## 1. Quick Deploy via Blueprint (`render.yaml`)

1. Push your changes to GitHub or merge your Pull Request.
2. In the [Render Dashboard](https://dashboard.render.com/):
   - Click **New +** > **Blueprint**.
   - Select your `transcripter` repository.
   - Render will detect `render.yaml` and configure the Web Service automatically.
3. Configure your Environment Variables:
   - `OPENROUTER_API_KEY`: API key from [OpenRouter](https://openrouter.ai/keys) (powers fast fallback models like `google/gemma-4-26b-a4b-it:free`).
   - `NVIDIA_API_KEY`: API key from [NVIDIA Build](https://build.nvidia.com/) (powers models like `nvidia/nemotron-3-ultra-550b-a55b` with `enable_thinking`).
   - `GEMINI_API_KEY` (or `GOOGLE_API_KEY`): API key from [Google AI Studio](https://aistudio.google.com/app/apikey).
   - `DATABASE_URL`: PostgreSQL connection string.
   - `SESSION_SECRET`: A secure 32+ character string.
   - `AUTH_EMAIL`: Admin email.
   - `AUTH_PASSWORD_HASH`: Admin bcrypt password hash.
4. Click **Apply**. Render will run:
   - `buildCommand`: `npm install && npm run build`
   - `startCommand`: `npm run start`

---

## 2. Multi-Provider AI Cascade Architecture

Transcripter includes a multi-provider cascade engine (`fetchAICascade`):

1. **User Custom Model Freedom**:
   - You can enter **any custom model string** directly in the Workspace or Admin settings (e.g. `nvidia/nemotron-3-ultra-550b-a55b`, `google/gemma-4-26b-a4b-it:free`, `gemini-2.0-flash`, or custom endpoints).
   - You are never locked into hardcoded legacy or retired models.

2. **NVIDIA NIM Primary (3 Retry Trials)**:
   - Evaluates primary models using NVIDIA NIM with up to 3 automatic trials.
   - Automatically enables thinking mode (`chat_template_kwargs: { enable_thinking: true }`) for Nemotron architectures.

3. **OpenRouter Secondary Fallback**:
   - If NVIDIA NIM is unavailable or rate-limited, requests cascade to OpenRouter using `OPENROUTER_API_KEY`.
   - Default fallback: `google/gemma-4-26b-a4b-it:free`.

4. **Google AI Studio Tertiary Fallback**:
   - High speed completions using `GEMINI_API_KEY` / `GOOGLE_API_KEY` (`gemini-2.0-flash`, `gemini-2.5-flash`, etc.).

5. **Safe Local Fallback**:
   - If external APIs fail or keys are omitted during setup, the deterministic local editorial engine processes the batch safely without crashing jobs.
