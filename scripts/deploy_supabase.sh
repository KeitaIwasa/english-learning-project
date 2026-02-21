#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "SUPABASE_PROJECT_REF is required"
  exit 1
fi

npx supabase login
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push

npx supabase functions deploy flashcards-add
npx supabase functions deploy chat-router
npx supabase functions deploy learning-profile-build
npx supabase functions deploy reading-generate-daily

echo "Supabase deployment complete."
