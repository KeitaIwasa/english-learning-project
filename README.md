# English Learning Platform MVP

Personal English learning platform with:
- Next.js web app
- Chrome extension (MV3)
- Supabase (Auth + DB + Edge Functions)
- Gemini API via Supabase Edge Functions

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

Deployment and setup details are in `infra/docs/setup-and-deploy.md`.
