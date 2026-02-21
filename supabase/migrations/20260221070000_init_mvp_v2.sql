create extension if not exists pgcrypto;

create type public.flashcard_source as enum ('web', 'extension', 'chat');
create type public.chat_mode as enum ('translate', 'ask', 'add_flashcard');

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  target_level text default 'A2',
  ui_lang text default 'ja',
  timezone text default 'Asia/Tokyo',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  en text not null,
  ja text not null,
  source public.flashcard_source not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.flashcard_reviews (
  id uuid primary key default gen_random_uuid(),
  flashcard_id uuid not null references public.flashcards(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  quality smallint not null check (quality between 0 and 5),
  interval_days integer not null default 1,
  ease_factor numeric(3,2) not null default 2.50,
  repetition integer not null default 0,
  reviewed_at timestamptz not null default now(),
  next_review_at timestamptz not null
);

create table if not exists public.chat_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.chat_threads(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant', 'system')),
  mode public.chat_mode not null,
  content text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.chat_learning_signals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_message_id uuid references public.chat_messages(id) on delete set null,
  signal_type text not null,
  signal_key text not null,
  weight numeric(4,2) not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists public.learning_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  target_date date not null,
  lookback_days integer not null default 14,
  review_targets_json jsonb not null default '[]'::jsonb,
  grammar_targets_json jsonb not null default '[]'::jsonb,
  new_candidates_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, target_date)
);

create table if not exists public.reading_passages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  profile_id uuid references public.learning_profiles(id) on delete set null,
  title text not null,
  body_en text not null,
  glossary_ja_json jsonb not null default '[]'::jsonb,
  difficulty text,
  generated_for_date date not null,
  used_review_targets_json jsonb not null default '[]'::jsonb,
  used_new_targets_json jsonb not null default '[]'::jsonb,
  rationale_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(user_id, generated_for_date)
);

create index if not exists idx_flashcards_user_created_at on public.flashcards(user_id, created_at desc);
create index if not exists idx_flashcard_reviews_user_reviewed_at on public.flashcard_reviews(user_id, reviewed_at desc);
create index if not exists idx_chat_learning_signals_user_created_at on public.chat_learning_signals(user_id, created_at desc);
create index if not exists idx_learning_profiles_user_date on public.learning_profiles(user_id, target_date desc);
create index if not exists idx_reading_passages_user_date on public.reading_passages(user_id, generated_for_date desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger set_flashcards_updated_at
before update on public.flashcards
for each row execute function public.set_updated_at();

create trigger set_chat_threads_updated_at
before update on public.chat_threads
for each row execute function public.set_updated_at();

alter table public.profiles enable row level security;
alter table public.flashcards enable row level security;
alter table public.flashcard_reviews enable row level security;
alter table public.chat_threads enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_learning_signals enable row level security;
alter table public.learning_profiles enable row level security;
alter table public.reading_passages enable row level security;

create policy if not exists "profiles_owner_all" on public.profiles
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "flashcards_owner_all" on public.flashcards
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "flashcard_reviews_owner_all" on public.flashcard_reviews
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "chat_threads_owner_all" on public.chat_threads
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "chat_messages_owner_all" on public.chat_messages
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "chat_learning_signals_owner_all" on public.chat_learning_signals
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "learning_profiles_owner_all" on public.learning_profiles
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

create policy if not exists "reading_passages_owner_all" on public.reading_passages
for all
using (auth.uid() = user_id)
with check (auth.uid() = user_id);
