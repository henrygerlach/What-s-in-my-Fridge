drop index if exists food_items_expiry_date_idx;
alter table food_items drop column if exists expiry_date;
