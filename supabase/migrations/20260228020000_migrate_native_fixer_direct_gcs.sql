alter table public.speech_fix_jobs
  add column if not exists gcs_bucket text,
  add column if not exists gcs_object_name text,
  add column if not exists gcs_upload_completed_at timestamptz;

update public.speech_fix_jobs
set
  gcs_bucket = coalesce(gcs_bucket, nullif(stats_json ->> 'gcsBucket', '')),
  gcs_object_name = coalesce(gcs_object_name, nullif(stats_json ->> 'gcsObjectName', ''))
where gcs_bucket is null or gcs_object_name is null;

alter table public.speech_fix_jobs
  drop column if exists storage_path;

drop policy if exists "speech_fixer_temp_owner_select" on storage.objects;
drop policy if exists "speech_fixer_temp_owner_insert" on storage.objects;
drop policy if exists "speech_fixer_temp_owner_delete" on storage.objects;
