create table shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  quantity numeric,
  unit text,
  created_at timestamptz not null default now()
);

create index shopping_list_items_created_at_idx on shopping_list_items (created_at);

alter table shopping_list_items enable row level security;

create policy "shopping_list_items_all" on shopping_list_items for all using (true) with check (true);
