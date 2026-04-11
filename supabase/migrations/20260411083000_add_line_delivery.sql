do $$
begin
  if not exists (select 1 from pg_type where typname = 'line_link_status') then
    create type public.line_link_status as enum ('unlinked', 'pending', 'linked');
  end if;
  if not exists (select 1 from pg_type where typname = 'line_delivery_job_status') then
    create type public.line_delivery_job_status as enum ('queued', 'processing', 'completed', 'failed');
  end if;
  if not exists (select 1 from pg_type where typname = 'line_delivery_trigger_type') then
    create type public.line_delivery_trigger_type as enum ('auto', 'manual');
  end if;
end
$$;

alter table public.profiles
  add column if not exists line_push_enabled boolean not null default false,
  add column if not exists line_user_id text,
  add column if not exists line_link_status public.line_link_status not null default 'unlinked',
  add column if not exists line_linked_at timestamptz,
  add column if not exists line_last_delivery_at timestamptz;

create unique index if not exists uq_profiles_line_user_id
  on public.profiles(line_user_id)
  where line_user_id is not null;

create table if not exists public.line_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_line_user_id text,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_line_link_codes_code
  on public.line_link_codes(code);

create index if not exists idx_line_link_codes_user_created_at
  on public.line_link_codes(user_id, created_at desc);

create index if not exists idx_line_link_codes_expires_at
  on public.line_link_codes(expires_at desc);

create table if not exists public.line_delivery_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  passage_id uuid not null references public.reading_passages(id) on delete cascade,
  target_date date not null,
  trigger_type public.line_delivery_trigger_type not null default 'auto',
  status public.line_delivery_job_status not null default 'queued',
  retry_count integer not null default 0 check (retry_count >= 0),
  line_user_id text not null,
  line_retry_key text not null,
  line_request_id text,
  payload_json jsonb not null default '{}'::jsonb,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, target_date)
);

create index if not exists idx_line_delivery_jobs_user_created_at
  on public.line_delivery_jobs(user_id, created_at desc);

create index if not exists idx_line_delivery_jobs_status
  on public.line_delivery_jobs(status, created_at desc);

drop trigger if exists set_line_delivery_jobs_updated_at on public.line_delivery_jobs;
create trigger set_line_delivery_jobs_updated_at
before update on public.line_delivery_jobs
for each row execute function public.set_updated_at();

alter table public.line_link_codes enable row level security;
alter table public.line_delivery_jobs enable row level security;

drop policy if exists "line_link_codes_owner_all" on public.line_link_codes;
create policy "line_link_codes_owner_all" on public.line_link_codes
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

drop policy if exists "line_delivery_jobs_owner_all" on public.line_delivery_jobs;
create policy "line_delivery_jobs_owner_all" on public.line_delivery_jobs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
