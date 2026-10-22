-- The cooking method on each recipe: numbered steps, so nobody has to watch
-- the whole video. recipes.steps holds them (one step per item); steps_source
-- says where they came from: 'video' (written from the video's description,
-- shown with a "check quantities with the video" note) or 'mom' (typed or
-- changed by Mom in Edit; hers always win). Guests see them too, through
-- family_recipes(), which now returns both columns.
--
-- Only adds columns, so nothing anyone has is touched. family_recipes() is
-- dropped and made again because what it returns changes; the older app asks
-- for the columns it knows and keeps working. Run it before deploying the app
-- version with the Method section (sw recipes-v38). Running it again does no
-- harm. One transaction.

begin;

alter table public.recipes add column if not exists steps text[];
alter table public.recipes add column if not exists steps_source text;

-- The app may write them (014 lists the writable columns one by one).
grant insert (steps, steps_source) on public.recipes to authenticated;
grant update (steps, steps_source) on public.recipes to authenticated;

drop function if exists public.family_recipes();
create function public.family_recipes()
returns table (
  id bigint, name text, category text, status text, link text, link_key text, source text,
  ingredients text[], last_cooked_at timestamptz, photo_path text, effort text,
  meals text[], tags text[], owner uuid, steps text[], steps_source text
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.category, r.status, r.link, r.link_key, r.source, r.ingredients,
         r.last_cooked_at, r.photo_path, r.effort, r.meals, r.tags, r.owner, r.steps, r.steps_source
  from public.recipes r
  where r.owner is null and (public.is_guest() or public.is_allowed())
    and r.status !~* '^\s*not\s+interested' and r.name !~* '\mignore\M';
$$;

revoke execute on function public.family_recipes() from public, anon;
grant execute on function public.family_recipes() to authenticated;

-- Guests' own recipes: at most 60 steps of 1,000 characters (as 014 limits the rest).
create or replace function public.guest_steps_limit() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated') or public.is_allowed() then
    return new;
  end if;
  if coalesce(array_length(new.steps, 1), 0) > 60
     or exists (select 1 from unnest(coalesce(new.steps, '{}')) s where char_length(s) > 1000)
     or char_length(coalesce(new.steps_source, '')) > 20 then
    raise exception 'That method is too long to save.' using errcode = '22001';
  end if;
  return new;
end;
$$;

revoke execute on function public.guest_steps_limit() from public, anon, authenticated;

drop trigger if exists recipes_guest_steps_limit on public.recipes;
create trigger recipes_guest_steps_limit before insert or update on public.recipes
  for each row execute function public.guest_steps_limit();

commit;
