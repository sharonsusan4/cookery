-- Adds "Quick & easy" / "Gourmet" to recipes. Run once in Supabase > SQL Editor
-- BEFORE deploying the app version that uses it (the app asks for this column).
-- Safe to run again.

-- 'quick' (quick and/or easy), 'gourmet' (special, for guests or festivals),
-- 'storage' (preserving and prep ideas, never suggested as a meal), or null
-- for an everyday dish. Plain text with no CHECK, like the other columns, so
-- a label can be added later without a migration.
alter table public.recipes add column if not exists effort text;
