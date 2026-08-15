-- Tracks every item that leaves the inventory fully used up, tagged as
-- either eaten ('consumed') or thrown out ('discarded'), so a simple waste
-- tally can be shown without requiring any expiry-date tracking.
create table consumption_log (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  quantity numeric,
  unit text,
  reason text not null check (reason in ('consumed', 'discarded')),
  logged_at timestamptz not null default now()
);

create index consumption_log_logged_at_idx on consumption_log (logged_at);

alter table consumption_log enable row level security;

create policy "consumption_log_all" on consumption_log for all using (true) with check (true);

alter publication supabase_realtime add table consumption_log;
