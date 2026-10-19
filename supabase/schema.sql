-- Run this once in Supabase: Dashboard > SQL Editor > New query > paste > Run.
create table if not exists public.records (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  store      text        not null,                 -- LifeOS store name, e.g. 'tasks'
  id         text        not null,                 -- record id inside that store
  data       jsonb,                                -- the full record (null for deletions)
  deleted    boolean     not null default false,   -- true = deletion marker
  updated_at timestamptz not null,                 -- client edit time, used for last-write-wins
  server_ts  timestamptz not null default clock_timestamp(), -- server time, used as the pull cursor
  primary key (user_id, store, id)
);
create index if not exists records_pull_idx on public.records (user_id, server_ts);

alter table public.records enable row level security;
drop policy if exists "own rows select" on public.records;
drop policy if exists "own rows insert" on public.records;
drop policy if exists "own rows update" on public.records;
drop policy if exists "own rows delete" on public.records;
create policy "own rows select" on public.records for select using (auth.uid() = user_id);
create policy "own rows insert" on public.records for insert with check (auth.uid() = user_id);
create policy "own rows update" on public.records for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows delete" on public.records for delete using (auth.uid() = user_id);

-- Stale writes are ignored (an older edit can never overwrite a newer one); server_ts is stamped on every write.
create or replace function public.records_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    return null;
  end if;
  new.server_ts := clock_timestamp();
  return new;
end $$;
drop trigger if exists records_guard on public.records;
create trigger records_guard before insert or update on public.records
  for each row execute function public.records_guard();

-- Instant cross-device updates (Realtime).
do $$ begin
  alter publication supabase_realtime add table public.records;
exception when duplicate_object then null; end $$;
