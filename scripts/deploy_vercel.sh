#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d "apps/web" ]]; then
  echo "apps/web not found"
  exit 1
fi

cd apps/web

if ! npx vercel whoami >/dev/null 2>&1; then
  echo "Vercel authentication required. Starting login..."
  npx vercel login
fi

npx vercel link --yes
npx vercel --prod --yes

echo "Vercel deployment complete."
