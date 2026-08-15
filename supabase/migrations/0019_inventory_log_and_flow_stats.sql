-- Mirrors consumption_log on the other side of the shelf: records every time
-- an item is added to food_items (manual entry, receipt scan, or fridge/pantry
-- photo scan), so statistics can show what comes in, not just what goes out.
create table inventory_log (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text,
  quantity numeric,
  unit text,
  location text not null,
  source text not null default 'manual' check (source in ('manual', 'receipt', 'photo', 'shopping')),
  logged_at timestamptz not null default now()
);

create index inventory_log_logged_at_idx on inventory_log (logged_at);

alter table inventory_log enable row level security;

create policy "inventory_log_all" on inventory_log for all using (true) with check (true);

alter publication supabase_realtime add table inventory_log;

-- Distinguishes stock used up manually ("Verbraucht" button) from stock used
-- up by cooking a recipe, and records which recipe when it was the latter, so
-- "favorite meal" / cooking-driven usage can be reported without joining
-- through food_items rows that no longer exist by then.
alter table consumption_log add column source text not null default 'manual' check (source in ('manual', 'cooked'));
alter table consumption_log add column recipe_title text;

-- Snapshot of the item's food_items.created_at at the moment it left
-- inventory, so average time-in-storage can be computed without needing to
-- keep the (by-then deleted) food_items row around.
alter table consumption_log add column item_added_at timestamptz;
