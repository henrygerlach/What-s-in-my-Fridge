-- Wochenplan reverts to a flat per-day list (its original design, see
-- 0012_meal_plan.sql) instead of breakfast/lunch/dinner/snack sections.
alter table meal_plan_items drop column meal_slot;
