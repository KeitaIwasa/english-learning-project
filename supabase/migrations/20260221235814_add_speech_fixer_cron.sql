create extension if not exists pg_net;
create extension if not exists pg_cron;

-- NOTE:
-- This migration was applied with the real CRON secret in production.
-- For new environments, replace <cron-secret> with the target env's CRON_SECRET before applying.

select cron.unschedule('speech-fixer-every-minute')
where exists (select 1 from cron.job where jobname = 'speech-fixer-every-minute');

select cron.schedule(
  'speech-fixer-every-minute',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://web-peach-seven-21.vercel.app/api/cron/speech-fixer',
    headers := '{"Content-Type":"application/json","x-cron-secret":"<cron-secret>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
