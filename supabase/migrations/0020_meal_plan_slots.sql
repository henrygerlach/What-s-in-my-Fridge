-- Explicit meal-time slot (breakfast/lunch/dinner/snack) per planned meal,
-- independent of the recipe's own category, so the same recipe can be
-- planned into any slot and the Wochenplan can show each day broken into
-- sections instead of one flat list. Existing rows default to 'dinner'
-- since "Große Mahlzeit" was, in practice, mostly used for planning the
-- evening meal.
alter table meal_plan_items
  add column meal_slot text not null default 'dinner'
  check (meal_slot in ('breakfast', 'lunch', 'dinner', 'snack'));
