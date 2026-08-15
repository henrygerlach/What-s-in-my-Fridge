create type location as enum ('fridge', 'pantry', 'freezer');

create table food_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default '',
  location location not null default 'fridge',
  quantity numeric,
  unit text,
  expiry_date date,
  created_at timestamptz not null default now()
);

create table recipes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  instructions text not null default '',
  photo_url text,
  created_at timestamptz not null default now()
);

create table recipe_ingredients (
  id uuid primary key default gen_random_uuid(),
  recipe_id uuid not null references recipes (id) on delete cascade,
  name text not null,
  quantity numeric,
  unit text
);

create index food_items_location_idx on food_items (location);
create index food_items_expiry_date_idx on food_items (expiry_date);
create index recipe_ingredients_recipe_id_idx on recipe_ingredients (recipe_id);

alter table food_items enable row level security;
alter table recipes enable row level security;
alter table recipe_ingredients enable row level security;

-- MVP is single-user with no auth gate on data access; open policies for the anon key.
create policy "food_items_all" on food_items for all using (true) with check (true);
create policy "recipes_all" on recipes for all using (true) with check (true);
create policy "recipe_ingredients_all" on recipe_ingredients for all using (true) with check (true);
