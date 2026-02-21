#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d "apps/web" ]]; then
  echo "apps/web not found"
  exit 1
fi

cd apps/web
npx vercel login
npx vercel link
npx vercel --prod

echo "Vercel deployment complete."
