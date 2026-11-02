-- Veg mode: each dish is veg or non-veg (meat, chicken, fish, prawns and
-- other seafood, egg). The app works it out from the dish's name and
-- ingredients; recipes.diet is Mom's own answer when the app gets one wrong
-- ('veg' or 'nonveg'; null = let the app decide). Guests get it through
-- family_recipes() so their Veg switch hides the same dishes.
--
-- Only adds a column, so nothing anyone has is touched. family_recipes() is
-- made again because what it returns changes; the older app asks for the
-- columns it knows and keeps working. Run it before deploying the app version
-- with the Veg switch (sw recipes-v39). Running it again does no harm. One
-- transaction.

begin;

alter table public.recipes add column if not exists diet text;
alter table public.recipes drop constraint if exists recipes_diet_known;
alter table public.recipes add constraint recipes_diet_known check (diet is null or diet in ('veg', 'nonveg'));

grant insert (diet) on public.recipes to authenticated;
grant update (diet) on public.recipes to authenticated;

drop function if exists public.family_recipes();
create function public.family_recipes()
returns table (
  id bigint, name text, category text, status text, link text, link_key text, source text,
  ingredients text[], last_cooked_at timestamptz, photo_path text, effort text,
  meals text[], tags text[], owner uuid, steps text[], steps_source text, diet text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.category, r.status, r.link, r.link_key, r.source, r.ingredients,
         r.last_cooked_at, r.photo_path, r.effort, r.meals, r.tags, r.owner, r.steps, r.steps_source, r.diet
  from public.recipes r
  where r.owner is null and (public.is_guest() or public.is_allowed())
    and r.status !~* '^\s*not\s+interested' and r.name !~* '\mignore\M';
$$;

revoke execute on function public.family_recipes() from public, anon;
grant execute on function public.family_recipes() to authenticated;

commit;
