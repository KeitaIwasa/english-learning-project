alter table public.reading_passages
add column if not exists updated_at timestamptz not null default now();

drop trigger if exists set_reading_passages_updated_at on public.reading_passages;
create trigger set_reading_passages_updated_at
before update on public.reading_passages
for each row execute function public.set_updated_at();
