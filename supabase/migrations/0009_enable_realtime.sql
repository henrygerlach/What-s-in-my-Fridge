-- Multiple household members use the app at once; adding these tables to the
-- realtime publication lets every open tab receive live postgres_changes
-- events instead of only seeing updates after a manual reload.
alter publication supabase_realtime add table food_items;
alter publication supabase_realtime add table recipes;
alter publication supabase_realtime add table recipe_ingredients;
alter publication supabase_realtime add table shopping_list_items;
