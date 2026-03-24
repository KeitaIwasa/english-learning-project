# Setup and Deploy Guide

## 1. Prerequisites

- Node.js `>=22.12.0` (recommended via `nvm`)
- npm `>=11`
- Supabase project (Free plan)
- Vercel account (Hobby plan)
- Gemini API key (Developer API)

### Install CLIs (optional)

Global install is optional because this project uses `npx`.

```bash
npm install -g vercel supabase
```

Without global install, use:

```bash
npx vercel --version
npx supabase --version
```

## 2. Install dependencies

```bash
npm install
```

## 3. Supabase setup

1. Create project in Supabase Dashboard.
2. Enable Google provider:
   - `Authentication > Providers > Google`
   - Add redirect URLs:
     - `http://localhost:3000/auth/callback`
     - `https://<your-vercel-domain>/auth/callback`
     - `https://<your-extension-id>.chromiumapp.org/*`
3. Set Function secrets:

```bash
npx supabase secrets set GEMINI_API_KEY=... GEMINI_FAST_MODEL=gemini-flash-latest GEMINI_REASONING_MODEL=gemini-pro-latest GEMINI_TTS_MODEL=gemini-2.5-pro-preview-tts GEMINI_TTS_SPEAKER1_NAME=Zephyr GEMINI_TTS_SPEAKER1_VOICE=Kore GEMINI_TTS_SPEAKER2_NAME=Orus GEMINI_TTS_SPEAKER2_VOICE=Puck
```

4. Deploy DB + Functions:

```bash
export SUPABASE_PROJECT_REF=your-project-ref
bash scripts/deploy_supabase.sh
```

## 4. Vercel setup

1. Add environment variables to Vercel:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `CRON_SECRET` (random long string)
2. Deploy web:

```bash
cd apps/web
npx vercel link --yes --scope keitaiwasas-projects
npx vercel --prod --yes --scope keitaiwasas-projects
```

### Vercel CLI scope note (important)

In non-interactive environments, Vercel may fail with:
`missing_scope: Provide --scope or --team explicitly`.

To prevent this failure, always deploy with explicit `--scope` (do not rely on defaults):

```bash
cd apps/web
npx vercel link --yes --scope <your-scope>
npx vercel --prod --yes --scope <your-scope>
```

Example for this project:

```bash
cd apps/web
npx vercel link --yes --scope keitaiwasas-projects
npx vercel --prod --yes --scope keitaiwasas-projects
```

### Deployment mistake log (2026-03-25)

- Mistake:
  - Ran production deploy without `--scope`, and deployment failed with `missing_scope`.
- Prevention rule:
  - Always run both `vercel link` and `vercel --prod` with `--scope keitaiwasas-projects` in this repo.
- Quick recovery command:

```bash
cd apps/web
npx vercel link --yes --scope keitaiwasas-projects
npx vercel --prod --yes --scope keitaiwasas-projects
```

## 5. Daily job setup (Supabase SQL Editor)

Run SQL with your actual project URL and service role key in headers.

```sql
create extension if not exists pg_net;
create extension if not exists pg_cron;

select cron.schedule(
  'learning-profile-build-daily',
  '50 20 * * *',
  $$
  select net.http_post(
    url := 'https://<your-vercel-domain>/api/cron/build-profile',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<cron-secret>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'reading-generate-daily',
  '00 21 * * *',
  $$
  select net.http_post(
    url := 'https://<your-vercel-domain>/api/cron/generate-reading',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<cron-secret>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

(UTC基準: 20:50 UTC = 05:50 JST, 21:00 UTC = 06:00 JST)

## 6. Chrome extension setup

```bash
cp apps/extension/src/config.example.js apps/extension/src/config.js
```

Fill values and load `apps/extension` via `chrome://extensions` (Developer mode).

## 7. Local run

```bash
npm run dev:web
```
