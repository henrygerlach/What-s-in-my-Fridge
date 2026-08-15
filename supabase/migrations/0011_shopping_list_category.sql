-- Lets the shopping list be grouped by category the same way the inventory
-- already is. Populated when the source item's category is already known
-- (e.g. re-adding a food item); left null otherwise and shown under
-- "Ohne Kategorie".
alter table shopping_list_items add column category text;
