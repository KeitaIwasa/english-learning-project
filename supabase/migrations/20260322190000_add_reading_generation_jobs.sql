create type public.reading_generation_trigger_type as enum ('manual', 'cron');
create type public.reading_generation_job_status as enum ('queued', 'processing', 'completed', 'failed');

create table if not exists public.reading_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_date date not null,
  trigger_type public.reading_generation_trigger_type not null default 'manual',
  status public.reading_generation_job_status not null default 'queued',
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_reading_generation_jobs_user_date_created
  on public.reading_generation_jobs(user_id, target_date, created_at desc);

create index if not exists idx_reading_generation_jobs_status
  on public.reading_generation_jobs(status, created_at desc);

create unique index if not exists uq_reading_generation_jobs_user_date_active
  on public.reading_generation_jobs(user_id, target_date)
  where status in ('queued', 'processing');

drop trigger if exists set_reading_generation_jobs_updated_at on public.reading_generation_jobs;
create trigger set_reading_generation_jobs_updated_at
before update on public.reading_generation_jobs
for each row execute function public.set_updated_at();

alter table public.reading_generation_jobs enable row level security;

drop policy if exists "reading_generation_jobs_owner_all" on public.reading_generation_jobs;
create policy "reading_generation_jobs_owner_all" on public.reading_generation_jobs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
