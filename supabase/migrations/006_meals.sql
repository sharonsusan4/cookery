-- Lets a dish choose which meals it shows in ("Shows in: Lunch, Dinner ·
-- Change" on a recipe), instead of always following its category. Run it
-- once in Supabase > SQL Editor (or with `supabase db query`) BEFORE
-- deploying the app version that uses it (that version asks for the column).
-- Running it again does no harm. schema.sql already includes it.

-- Meal names from MEALS in app/app.js: Breakfast, Lunch, Snacks, Dinner,
-- Desserts, Drinks. Null (every existing row) means "the meals its category
-- belongs to", as before. Whether it shows as a main dish or "On the side"
-- for a meal still follows the category. Plain text with no CHECK, like the
-- other columns; the app ignores any name it doesn't know.
--
-- No rule changes: allowed users can already change any recipe, and guests
-- only their own (migration 005).
alter table public.recipes add column if not exists meals text[];
