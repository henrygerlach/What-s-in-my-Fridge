-- Freeform tags (e.g. "vegetarisch", "schnell") for filtering recipes beyond
-- the fixed meal-type categories.
alter table recipes add column tags text[] not null default '{}';
