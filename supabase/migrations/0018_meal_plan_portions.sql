-- Lets each meal plan entry record how many portions it's planned for,
-- independent of the recipe's own default portions, so ingredient amounts
-- pulled into the shopping list can be scaled to what's actually planned.
alter table meal_plan_items add column portions integer;
