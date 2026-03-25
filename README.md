# English Learning Platform 

Personal English learning platform with:
- Next.js web app
- Chrome extension (MV3)
- Supabase (Auth + DB)
- Cloud Tasks + Cloud Run workers
- Gemini API via Next.js / worker runtime

## Quick start

1. Install dependencies:
   ```bash
   npm install
   ```
2. Copy env template:
   ```bash
   cp apps/web/.env.local.example apps/web/.env.local
   ```
3. Run web app:
   ```bash
   npm run dev:web
   ```

## Deploy (production)

```bash
# Supabase
npm run deploy:supabase

# Vercel
cd apps/web
npx vercel link --yes --scope keitaiwasas-projects
npx vercel --prod --yes --scope keitaiwasas-projects
cd ../..

# Cloud Run (gcloud)
gcloud run deploy english-native-fixer --image=us-west1-docker.pkg.dev/ai-studio-registry-prod/ai-studio/deploy-container@sha256:ad9b1d5c6cc21099fa078e6593ef3c70cf20fb84545d6dffd245211c6dcc79eb --region=us-west1 --platform=managed --project=gen-lang-client-0926290743 --quiet
gcloud run deploy speaker-diarization-transcriber --image=us-docker.pkg.dev/cloudrun/container/aistudio/applet-proxy --region=us-west1 --platform=managed --project=gen-lang-client-0926290743 --quiet
```

Deployment and setup details are in `infra/docs/setup-and-deploy.md`.
