-- Recipe categories switched from meal-time ("Mittagessen"/"Abendessen") to
-- meal-type ("Warme Mahlzeit"), so existing recipes need remapping to keep
-- showing up correctly (e.g. in the "Was koche ich heute?" widget).
update recipes set category = 'Warme Mahlzeit' where category in ('Mittagessen', 'Abendessen');
