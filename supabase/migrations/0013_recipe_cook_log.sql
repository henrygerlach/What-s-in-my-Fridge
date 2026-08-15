-- Records every time "Gekocht" is pressed on a recipe, so the recipe list
-- can show how long ago (or whether at all) a recipe was last cooked.
create table recipe_cook_log (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes (id) on delete cascade,
  cooked_at timestamptz not null default now()
);

create index recipe_cook_log_recipe_id_idx on recipe_cook_log (recipe_id);

alter table recipe_cook_log enable row level security;

create policy "recipe_cook_log_all" on recipe_cook_log for all using (true) with check (true);

alter publication supabase_realtime add table recipe_cook_log;
