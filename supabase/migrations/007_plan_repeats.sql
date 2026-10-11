-- Lets the same dish go on the meal plan more than once: twice in one meal
-- (two lots of chapati), in another meal or on other days. Run it once in
-- Supabase > SQL Editor (or with `supabase db query`) BEFORE deploying the app
-- version that uses it (that version adds a dish again instead of skipping
-- it, and the old rule would turn the second one away).
-- Running it again does no harm: both drops are "if exists".
-- schema.sql already includes it.

-- Each planned copy is its own row (its own id), so taking one off removes
-- just that row and leaves the others. No rule changes: allowed users and
-- guests (their own rows) can still only read, add and take dishes off.

-- From 005_guests.sql: the same dish once per meal, per person.
alter table public.meal_plan drop constraint if exists meal_plan_day_meal_recipe_id_guest_id_key;
-- From 004_meal_plan.sql, in case 005 never got to drop it.
alter table public.meal_plan drop constraint if exists meal_plan_day_meal_recipe_id_key;
