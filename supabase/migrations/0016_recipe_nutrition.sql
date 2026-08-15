-- Cached per-portion nutrition estimate (from the estimate-nutrition edge
-- function), so it's computed once per recipe instead of on every view.
alter table recipes add column kcal_per_portion numeric;
alter table recipes add column protein_g_per_portion numeric;
alter table recipes add column fat_g_per_portion numeric;
alter table recipes add column carbs_g_per_portion numeric;
