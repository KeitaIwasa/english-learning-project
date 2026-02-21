create type public.speech_fix_job_status as enum ('uploaded', 'queued', 'processing', 'completed', 'failed');

create table if not exists public.speech_fix_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  file_name text not null,
  custom_title text,
  file_size bigint not null,
  mime_type text not null,
  status public.speech_fix_job_status not null default 'uploaded',
  storage_path text,
  transcript_full text,
  corrections_json jsonb not null default '[]'::jsonb,
  stats_json jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_speech_fix_jobs_user_created_at on public.speech_fix_jobs(user_id, created_at desc);
create index if not exists idx_speech_fix_jobs_user_completed_at on public.speech_fix_jobs(user_id, completed_at desc nulls last);

drop trigger if exists set_speech_fix_jobs_updated_at on public.speech_fix_jobs;
create trigger set_speech_fix_jobs_updated_at
before update on public.speech_fix_jobs
for each row execute function public.set_updated_at();

alter table public.speech_fix_jobs enable row level security;

drop policy if exists "speech_fix_jobs_owner_all" on public.speech_fix_jobs;
create policy "speech_fix_jobs_owner_all" on public.speech_fix_jobs
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'speech-fixer-temp',
  'speech-fixer-temp',
  false,
  262144000,
  array['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/aac', 'audio/mp4', 'audio/m4a']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "speech_fixer_temp_owner_select" on storage.objects;
create policy "speech_fixer_temp_owner_select" on storage.objects
for select
to authenticated
using (bucket_id = 'speech-fixer-temp' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "speech_fixer_temp_owner_insert" on storage.objects;
create policy "speech_fixer_temp_owner_insert" on storage.objects
for insert
to authenticated
with check (bucket_id = 'speech-fixer-temp' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "speech_fixer_temp_owner_delete" on storage.objects;
create policy "speech_fixer_temp_owner_delete" on storage.objects
for delete
to authenticated
using (bucket_id = 'speech-fixer-temp' and (storage.foldername(name))[1] = auth.uid()::text);
