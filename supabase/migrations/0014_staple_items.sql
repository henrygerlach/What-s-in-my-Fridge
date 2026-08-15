-- Names the household always wants to keep stocked (e.g. flour, rice, oil),
-- independent of any single food_items row — that row disappears once the
-- item is fully used up, but the "always keep this around" designation
-- shouldn't disappear with it. A unique index on the lowercased name avoids
-- duplicate staples that only differ in case.
create table staple_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create unique index staple_items_name_lower_idx on staple_items (lower(name));

alter table staple_items enable row level security;

create policy "staple_items_all" on staple_items for all using (true) with check (true);

alter publication supabase_realtime add table staple_items;
