#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
ENV_FILE="$(mktemp)"
SQL_FILE="$(mktemp)"

cleanup() {
  rm -f "$ENV_FILE" "$SQL_FILE"
}
trap cleanup EXIT

cd "$WEB_DIR"
npx vercel env pull "$ENV_FILE" --environment=production --scope keitaiwasas-projects --yes >/dev/null

node - "$ENV_FILE" "$SQL_FILE" <<'NODE'
const fs = require("fs");

const envPath = process.argv[2];
const sqlPath = process.argv[3];

function parseEnv(text) {
  const out = {};
  for (const rawLine of text.split(/\n/)) {
    if (!rawLine || rawLine.startsWith("#")) {
      continue;
    }
    const separator = rawLine.indexOf("=");
    if (separator < 0) {
      continue;
    }
    const key = rawLine.slice(0, separator);
    let value = rawLine.slice(separator + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").trim();
  }
  return out;
}

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

const env = parseEnv(fs.readFileSync(envPath, "utf8"));
const appUrl = (env.NEXT_PUBLIC_APP_URL || "https://web-peach-seven-21.vercel.app").replace(/\/$/, "");
const cronSecret = env.CRON_SECRET;

if (!cronSecret) {
  throw new Error("CRON_SECRET is missing from Vercel production env");
}

const headers = JSON.stringify({
  "Content-Type": "application/json",
  "x-cron-secret": cronSecret
});

const sql = `create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema extensions;

select cron.unschedule('learning-profile-build-daily')
where exists (select 1 from cron.job where jobname = 'learning-profile-build-daily');

select cron.unschedule('reading-generate-daily')
where exists (select 1 from cron.job where jobname = 'reading-generate-daily');

select cron.schedule(
  'learning-profile-build-daily',
  '50 20 * * *',
  $$
  select net.http_post(
    url := ${sqlLiteral(`${appUrl}/api/cron/build-profile`)},
    headers := ${sqlLiteral(headers)}::jsonb,
    body := '{}'::jsonb
  );
  $$
);

select cron.schedule(
  'reading-generate-daily',
  '00 21 * * *',
  $$
  select net.http_post(
    url := ${sqlLiteral(`${appUrl}/api/cron/generate-reading`)},
    headers := ${sqlLiteral(headers)}::jsonb,
    body := '{}'::jsonb
  );
  $$
);
`;

fs.writeFileSync(sqlPath, sql, { mode: 0o600 });
console.log(`Registering daily cron jobs for ${appUrl}`);
NODE

cd "$ROOT_DIR"
npx supabase db query --linked -f "$SQL_FILE" -o table
npx supabase db query --linked -o table \
  "select jobname, schedule, active from cron.job where jobname in ('learning-profile-build-daily', 'reading-generate-daily') order by jobname;"
