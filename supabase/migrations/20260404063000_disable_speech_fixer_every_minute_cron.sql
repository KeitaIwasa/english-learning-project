select cron.unschedule('speech-fixer-every-minute')
where exists (select 1 from cron.job where jobname = 'speech-fixer-every-minute');
