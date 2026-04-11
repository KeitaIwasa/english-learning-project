# Setup and Deploy Guide
環境構築とデプロイ方法をまとめたドキュメントです。
このドキュメントに変更点や改善点があれば、修正してください。

## 0. Production deploy (quick runbook)

Run from repository root:

```bash
# 1) Supabase DB
npm run deploy:supabase

# 2) Vercel (always with explicit scope)
cd apps/web
npx vercel link --yes --scope keitaiwasas-projects
npx vercel --prod --yes --scope keitaiwasas-projects
cd ../..

# 3) Cloud Run services (optional; not required for current production web worker path)
gcloud run deploy english-native-fixer \
  --image=us-west1-docker.pkg.dev/ai-studio-registry-prod/ai-studio/deploy-container@sha256:ad9b1d5c6cc21099fa078e6593ef3c70cf20fb84545d6dffd245211c6dcc79eb \
  --region=us-west1 \
  --platform=managed \
  --project=gen-lang-client-0926290743 \
  --quiet

gcloud run deploy speaker-diarization-transcriber \
  --image=us-docker.pkg.dev/cloudrun/container/aistudio/applet-proxy \
  --region=us-west1 \
  --platform=managed \
  --project=gen-lang-client-0926290743 \
  --quiet
```

Post-deploy check:

```bash
gcloud run services list \
  --platform=managed \
  --project=gen-lang-client-0926290743 \
  --format='table(metadata.name,metadata.labels."cloud.googleapis.com/location",status.url,status.latestReadyRevisionName)'
```

## 1. Prerequisites

- Node.js `>=22.12.0` (recommended via `nvm`)
- npm `>=11`
- Supabase project (Free plan)
- Vercel account (Hobby plan)
- Google Cloud SDK (`gcloud`)
- GCP project: `gen-lang-client-0926290743`
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
   - `CLOUD_RUN_PROFILE_WORKER_URL`
   - `CLOUD_RUN_LINE_DELIVERY_WORKER_URL`
   - `CLOUD_RUN_READING_WORKER_URL`
   - `CLOUD_RUN_SPEECH_FIXER_WORKER_URL`
   - `CLOUD_TASKS_PROJECT_ID`
   - `CLOUD_TASKS_LOCATION`
   - `CLOUD_TASKS_QUEUE_LINE_DELIVERY`
   - `CLOUD_TASKS_QUEUE_PROFILE`
   - `CLOUD_TASKS_QUEUE_READING`
   - `CLOUD_TASKS_QUEUE_SPEECH_FIXER`
    - `GOOGLE_APPLICATION_CREDENTIALS_JSON`
    - `GCS_TEMP_BUCKET`
   - `LINE_AUDIO_GCS_BUCKET`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`
   - `WORKER_SHARED_SECRET`
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

## 5. Cloud Run worker deploy (gcloud)

Current production routes `CLOUD_RUN_*_WORKER_URL` to Vercel worker endpoints such as
`https://<your-vercel-domain>/api/workers/speech-fixer-process` and
`https://<your-vercel-domain>/api/workers/line-delivery`.
That means changes to `apps/web/app/api/workers/*` are deployed via Vercel, not via the Cloud Run services below.

This repository currently uses the following Cloud Run services in `us-west1`:

- `english-native-fixer`
- `speaker-diarization-transcriber`

If you later switch `CLOUD_RUN_SPEECH_FIXER_WORKER_URL` back to `english-native-fixer`, make sure the deployed app artifact still includes the bundled `ffmpeg-static` and `ffprobe-static` binaries because long audio is split into 15-minute chunks before Google Speech-to-Text v2 submission.

Check current services:

```bash
gcloud run services list \
  --platform=managed \
  --project=gen-lang-client-0926290743 \
  --format='table(metadata.name,metadata.labels."cloud.googleapis.com/location",status.url,status.latestReadyRevisionName)'
```

Describe current image for a service:

```bash
gcloud run services describe english-native-fixer \
  --region=us-west1 \
  --platform=managed \
  --project=gen-lang-client-0926290743 \
  --format='yaml(spec.template.spec.containers[0].image,status.latestReadyRevisionName)'
```

Deploy commands:

```bash
gcloud run deploy english-native-fixer \
  --image=us-west1-docker.pkg.dev/ai-studio-registry-prod/ai-studio/deploy-container@sha256:ad9b1d5c6cc21099fa078e6593ef3c70cf20fb84545d6dffd245211c6dcc79eb \
  --region=us-west1 \
  --platform=managed \
  --project=gen-lang-client-0926290743 \
  --quiet

gcloud run deploy speaker-diarization-transcriber \
  --image=us-docker.pkg.dev/cloudrun/container/aistudio/applet-proxy \
  --region=us-west1 \
  --platform=managed \
  --project=gen-lang-client-0926290743 \
  --quiet
```

## 6. Daily job setup (Supabase SQL Editor)

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

## 6.1 LINE auto-delivery setup

1. Create a new LINE Official Account and enable Messaging API.
2. Set the webhook URL to:
   - `https://<your-vercel-domain>/api/line/webhook`
3. Add the bot as a friend from the target LINE account.
4. Create a GCS bucket for LINE audio delivery and set:
   - `LINE_AUDIO_GCS_BUCKET`
5. Add a dedicated Cloud Tasks queue for LINE delivery and set:
   - `CLOUD_TASKS_QUEUE_LINE_DELIVERY`
   - `CLOUD_RUN_LINE_DELIVERY_WORKER_URL=https://<your-vercel-domain>/api/workers/line-delivery`
6. Add the LINE channel secrets to Vercel:
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`

## 7. Chrome extension setup

```bash
cp apps/extension/src/config.example.js apps/extension/src/config.js
```

Fill values and load `apps/extension` via `chrome://extensions` (Developer mode).

## 8. Local run

```bash
npm run dev:web
```
