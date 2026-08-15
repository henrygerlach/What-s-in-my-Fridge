-- Weekly meal planner: assigns recipes to specific dates. Multiple recipes
-- per day are allowed (e.g. lunch + dinner) since there's no meal-slot
-- concept, just a date.
create table meal_plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_date date not null,
  recipe_id uuid not null references recipes (id) on delete cascade,
  created_at timestamptz not null default now()
);

create index meal_plan_items_plan_date_idx on meal_plan_items (plan_date);

alter table meal_plan_items enable row level security;

create policy "meal_plan_items_all" on meal_plan_items for all using (true) with check (true);

alter publication supabase_realtime add table meal_plan_items;
