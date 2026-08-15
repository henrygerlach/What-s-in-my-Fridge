-- Container units like Dose/Packung/Glas/Stück/Bund have no fixed weight —
-- a can of tomatoes and a can of coconut milk aren't the same size. This
-- lets a food item or recipe ingredient optionally record what one of its
-- unit actually weighs (e.g. "1 Dose = 400 g"), so stock matching can
-- convert through grams and compare quantities across otherwise
-- incompatible units instead of assuming availability whenever it can't compare.
alter table food_items add column grams_per_unit numeric;
alter table recipe_ingredients add column grams_per_unit numeric;
