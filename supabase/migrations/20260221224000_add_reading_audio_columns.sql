alter table public.reading_passages
  add column if not exists audio_base64 text,
  add column if not exists audio_mime_type text,
  add column if not exists audio_voice text;
