-- "Warme Mahlzeit" renamed to "Große Mahlzeit" throughout the app; existing
-- recipes need remapping to keep showing up correctly (e.g. in the "Was
-- koche ich heute?" widget, which matches on the exact category string).
update recipes set category = 'Große Mahlzeit' where category = 'Warme Mahlzeit';
