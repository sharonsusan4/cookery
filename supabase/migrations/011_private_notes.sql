-- Keeps Mom's notes away from guests in the database itself, not just on screen.
--
-- Until now guests could read Mom's recipes (owner is null) straight from the
-- recipes table. The rules there are per row, so a guest who asked the API
-- for the notes column would have got it, even though the app never asks.
-- Now guests read only their own recipes from the table, and Mom's through
-- family_recipes(), which hands back every column the app shows except notes.
-- Mom and Sharon are unchanged: they still read the table, notes and all.
--
-- Run it before deploying the app version that calls family_recipes() (the
-- older app would show guests an empty recipe list once this is in). Running
-- it again does no harm. One transaction: all of it goes in, or none.

begin;

-- Mom's recipes, without her notes, for guests (and allowed users, though
-- the app gives them the table). Nobody else gets any rows.
create or replace function public.family_recipes()
returns table (
  id bigint,
  name text,
  category text,
  status text,
  link text,
  link_key text,
  source text,
  ingredients text[],
  last_cooked_at timestamptz,
  photo_path text,
  effort text,
  meals text[],
  tags text[],
  owner uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.category, r.status, r.link, r.link_key, r.source, r.ingredients,
         r.last_cooked_at, r.photo_path, r.effort, r.meals, r.tags, r.owner
  from public.recipes r
  where r.owner is null and (public.is_guest() or public.is_allowed());
$$;

revoke execute on function public.family_recipes() from public, anon;
grant execute on function public.family_recipes() to authenticated;

-- Guests read only their own rows of the table now.
drop policy if exists "Guests can read family and own recipes" on public.recipes;
drop policy if exists "Guests can read their own recipes" on public.recipes;
create policy "Guests can read their own recipes"
  on public.recipes for select to authenticated
  using (owner = (select auth.uid()) and (select public.is_guest()));

commit;
