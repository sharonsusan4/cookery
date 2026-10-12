-- Lets a dish belong to collections Mom can browse on the Recipes tab:
-- "Naadan" (Kerala home-style) and "One pot" (easy, bachelor-style one-pot
-- meals). Run it once in Supabase > SQL Editor (or with `supabase db query`)
-- BEFORE deploying the app version that uses it (that version asks for the
-- column). Running it again does no harm. schema.sql already includes it.

-- Lowercase keys from COLLECTIONS in app/app.js: 'naadan' and 'onepot' for
-- now. A dish can be in either, both or neither; null or an empty list (every
-- existing row) means neither. Plain text with no CHECK, like the other
-- columns, so a collection can be added later without a migration; the app
-- keeps any key it doesn't know when a recipe is saved.
--
-- No rule changes: allowed users can already change any recipe, and guests
-- only their own (migration 005).
alter table public.recipes add column if not exists tags text[];
