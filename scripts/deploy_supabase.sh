#!/usr/bin/env bash
set -euo pipefail

# Load local deploy config if present (not tracked in git).
LOCAL_DEPLOY_ENV="$HOME/.config/english-learning-project/deploy.env"
if [[ -f "$LOCAL_DEPLOY_ENV" ]]; then
  # shellcheck disable=SC1090
  source "$LOCAL_DEPLOY_ENV"
fi

if [[ -z "${SUPABASE_PROJECT_REF:-}" ]]; then
  echo "SUPABASE_PROJECT_REF is required"
  exit 1
fi

if [[ -n "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  npx supabase login --token "$SUPABASE_ACCESS_TOKEN"
else
  npx supabase login
fi
npx supabase link --project-ref "$SUPABASE_PROJECT_REF"
npx supabase db push

npx supabase functions deploy flashcards-add
npx supabase functions deploy chat-router
npx supabase functions deploy learning-profile-build
npx supabase functions deploy reading-generate-daily

echo "Supabase deployment complete."
