-- Adds guest mode: family members come in through a family link
-- (…/#join=<code>) as Supabase anonymous users, with no email and no password.
-- They can read Mom's recipes and keep their own recipes, meal plan and
-- shopping list next to hers, without ever changing hers.
--
-- Run it once in Supabase > SQL Editor (or with `supabase db query`) BEFORE
-- deploying the app version that has guest mode (that version asks for the
-- new columns). Running it again does no harm: everything is "if not exists",
-- "create or replace", or dropped and made again. It is one transaction, so
-- it either all goes in or none of it does.
-- schema.sql already includes all of this for a brand-new project.
--
-- Needs Postgres 15 or newer (for "unique nulls not distinct"); every
-- Supabase project made since 2023 is.
--
-- Who can do what afterwards:
--   Mom and Sharon (allowed_users): exactly as before. Their rules are not
--     changed. They can also read the guest list, make a new family link and
--     remove a guest.
--   A guest (an anonymous user with a row in public.guests): reads Mom's
--     recipes (owner is null) and their own, and the dish photos; adds,
--     changes and deletes only their own recipes, plan and list rows.
--   An anonymous user who hasn't joined: sees nothing and can change nothing.
--     The only useful thing it can do is call join_family() with the code.

begin;

-- ---------- the family code (never readable by guests) ----------

-- A schema the API doesn't expose (Supabase only exposes "public" unless
-- told otherwise), so nothing in it can be read through the app's key.
create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon, authenticated;

-- The one current code. "Make a new link" replaces it, and old links stop
-- letting new people in (people already in stay in).
create table if not exists private.family_code (
  id boolean primary key default true check (id),
  code text not null,
  created_at timestamptz not null default now()
);

-- Wrong codes, so one anonymous session can't simply try codes forever.
create table if not exists private.join_failures (
  user_id uuid not null,
  at timestamptz not null default now()
);
create index if not exists join_failures_user_id_at_idx on private.join_failures (user_id, at);

-- Belt and braces: even if "private" were ever exposed, no rules means no rows.
alter table private.family_code enable row level security;
alter table private.join_failures enable row level security;
revoke all on all tables in schema private from public, anon, authenticated;

-- A new random code: 12 characters from 31 that can't be mixed up (no i, l,
-- o, 0 or 1), lowercase so it survives being typed or autocorrected.
-- gen_random_uuid() uses the server's strong random source; the bytes holding
-- the uuid's fixed version and variant bits are skipped, and bytes 248-255 are
-- thrown away so every character is equally likely.
create or replace function private.make_family_code() returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  result text := '';
  bytes bytea;
  b int;
begin
  while length(result) < 12 loop
    bytes := uuid_send(gen_random_uuid());
    for i in 0..15 loop
      continue when i in (6, 8);
      b := get_byte(bytes, i);
      continue when b >= 248;
      result := result || substr(alphabet, (b % 31) + 1, 1);
      exit when length(result) >= 12;
    end loop;
  end loop;
  return result;
end;
$$;

revoke execute on function private.make_family_code() from public, anon, authenticated;

-- ---------- guests ----------

-- One row per family member who came in through the link. user_id is their
-- anonymous user. Deleting that user (Authentication > Users) removes the row,
-- and their recipes, plan and list rows, too.
create table if not exists public.guests (
  user_id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- Only Mom and Sharon read it (the Visitors page). Nobody writes to it
-- directly: join_family(), touch_guest() and remove_guest() do.
alter table public.guests enable row level security;
revoke all on public.guests from anon, authenticated;
grant select on public.guests to authenticated;

drop policy if exists "Allowed users can see guests" on public.guests;
create policy "Allowed users can see guests"
  on public.guests for select to authenticated
  using ((select public.is_allowed()));

-- True when the signed-in person joined through the family link (and hasn't
-- been removed). "security definer" so the rules can use it although guests
-- can't read the guests table.
create or replace function public.is_guest() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.guests g
    where g.user_id = (select auth.uid())
  );
$$;

revoke execute on function public.is_guest() from public, anon;
grant execute on function public.is_guest() to authenticated;

-- Called by the app right after signInAnonymously(). True when the code is
-- the current one: the caller is then a guest under `name` (trimmed, at most
-- 40 characters). False for a wrong code, no sign-in, an empty name, Mom or
-- Sharon (they never become guests), or after 10 wrong codes in 15 minutes.
create or replace function public.join_family(code text, name text) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  current_code text;
  clean_name text;
begin
  if uid is null or public.is_allowed() then
    return false;
  end if;

  if (select count(*) from private.join_failures f
      where f.user_id = uid and f.at > now() - interval '15 minutes') >= 10 then
    return false;
  end if;

  select fc.code into current_code from private.family_code fc where fc.id;

  -- Compared as hashes, so how long the comparison takes says nothing about the code.
  if current_code is null or
     sha256(convert_to(lower(trim(coalesce(join_family.code, ''))), 'UTF8')) <>
     sha256(convert_to(current_code, 'UTF8')) then
    insert into private.join_failures (user_id) values (uid);
    delete from private.join_failures f where f.at < now() - interval '1 day';
    return false;
  end if;

  clean_name := trim(left(trim(regexp_replace(coalesce(join_family.name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 40));
  if clean_name = '' then
    return false;
  end if;

  insert into public.guests as g (user_id, name)
  values (uid, clean_name)
  on conflict (user_id) do update set name = excluded.name, last_seen = now();
  return true;
end;
$$;

revoke execute on function public.join_family(text, text) from public, anon;
grant execute on function public.join_family(text, text) to authenticated;

-- Once each time a guest opens the app: "last visit" on the Visitors page.
-- Returns the guest's name, or null when they aren't (or are no longer) a
-- guest, so the app can tell they've been removed.
create or replace function public.touch_guest() returns text
language sql
volatile
security definer
set search_path = ''
as $$
  update public.guests g
  set last_seen = now()
  where g.user_id = (select auth.uid())
  returning g.name;
$$;

revoke execute on function public.touch_guest() from public, anon;
grant execute on function public.touch_guest() to authenticated;

-- Mom and Sharon only: a new family code, which replaces the old one.
create or replace function public.new_family_code() returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  fresh text;
begin
  if not public.is_allowed() then
    raise exception 'Only allowed users can make a family link' using errcode = '42501';
  end if;
  fresh := private.make_family_code();
  insert into private.family_code (id, code, created_at)
  values (true, fresh, now())
  on conflict (id) do update set code = excluded.code, created_at = excluded.created_at;
  return fresh;
end;
$$;

revoke execute on function public.new_family_code() from public, anon;
grant execute on function public.new_family_code() to authenticated;

-- Mom and Sharon only: the current code, so the Visitors page can show the
-- link to copy or share again without making a new one.
create or replace function public.get_family_code() returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed() then
    raise exception 'Only allowed users can see the family link' using errcode = '42501';
  end if;
  return (select fc.code from private.family_code fc where fc.id);
end;
$$;

revoke execute on function public.get_family_code() from public, anon;
grant execute on function public.get_family_code() to authenticated;

-- Mom and Sharon only: takes a guest out. From then on they see nothing (their
-- rows stay, hidden, in case they come back with a current link on the same phone).
create or replace function public.remove_guest(guest uuid) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_allowed() then
    raise exception 'Only allowed users can remove a guest' using errcode = '42501';
  end if;
  delete from public.guests g where g.user_id = remove_guest.guest;
  return found;
end;
$$;

revoke execute on function public.remove_guest(uuid) from public, anon;
grant execute on function public.remove_guest(uuid) to authenticated;

-- ---------- recipes: guests' own ----------

-- Null: Mom's (the family's) recipe. Every existing row stays null. Otherwise
-- the guest who added it. The app shows allowed users only owner is null.
alter table public.recipes add column if not exists owner uuid references auth.users (id) on delete cascade;
create index if not exists recipes_owner_idx on public.recipes (owner);

-- link_key is not unique (her sheet already had repeats; see schema.sql), so
-- a guest saving a video Mom already has never collides with hers. Nothing to change.

drop policy if exists "Guests can read family and own recipes" on public.recipes;
create policy "Guests can read family and own recipes"
  on public.recipes for select to authenticated
  using ((owner is null or owner = (select auth.uid())) and (select public.is_guest()));

drop policy if exists "Guests can add their own recipes" on public.recipes;
create policy "Guests can add their own recipes"
  on public.recipes for insert to authenticated
  with check (owner = (select auth.uid()) and (select public.is_guest()));

drop policy if exists "Guests can change their own recipes" on public.recipes;
create policy "Guests can change their own recipes"
  on public.recipes for update to authenticated
  using (owner = (select auth.uid()) and (select public.is_guest()))
  with check (owner = (select auth.uid()) and (select public.is_guest()));

drop policy if exists "Guests can delete their own recipes" on public.recipes;
create policy "Guests can delete their own recipes"
  on public.recipes for delete to authenticated
  using (owner = (select auth.uid()) and (select public.is_guest()));

-- Guests may delete their own recipes, so "authenticated" needs the delete
-- permission now. There is still no delete rule for allowed users, so Mom's
-- recipes can't be deleted through the app, and this trigger makes that
-- doubly sure: a family recipe (owner is null) can't be deleted by anyone
-- signed in through the app. The SQL Editor and Table Editor still can.
create or replace function public.keep_family_recipes() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.owner is null and current_user in ('anon', 'authenticated') then
    raise exception 'Family recipes are never deleted' using errcode = '42501';
  end if;
  return old;
end;
$$;

drop trigger if exists recipes_keep_family on public.recipes;
create trigger recipes_keep_family
  before delete on public.recipes
  for each row execute function public.keep_family_recipes();

grant delete on public.recipes to authenticated;

-- ---------- shopping list: guests' own ----------

-- Null: the household list (Mom's and Sharon's). Every existing row stays null.
alter table public.shopping_items add column if not exists guest_id uuid references auth.users (id) on delete cascade;
create index if not exists shopping_items_guest_id_idx on public.shopping_items (guest_id);

drop policy if exists "Guests can read their own shopping list" on public.shopping_items;
create policy "Guests can read their own shopping list"
  on public.shopping_items for select to authenticated
  using (guest_id = (select auth.uid()) and (select public.is_guest()));

drop policy if exists "Guests can add to their own shopping list" on public.shopping_items;
create policy "Guests can add to their own shopping list"
  on public.shopping_items for insert to authenticated
  with check (guest_id = (select auth.uid()) and (select public.is_guest()));

drop policy if exists "Guests can tick their own shopping list" on public.shopping_items;
create policy "Guests can tick their own shopping list"
  on public.shopping_items for update to authenticated
  using (guest_id = (select auth.uid()) and (select public.is_guest()))
  with check (guest_id = (select auth.uid()) and (select public.is_guest()));

drop policy if exists "Guests can clear their own shopping list" on public.shopping_items;
create policy "Guests can clear their own shopping list"
  on public.shopping_items for delete to authenticated
  using (guest_id = (select auth.uid()) and (select public.is_guest()));

-- ---------- meal plan: guests' own ----------

-- Null: the household plan. Every existing row stays null.
alter table public.meal_plan add column if not exists guest_id uuid references auth.users (id) on delete cascade;
create index if not exists meal_plan_guest_id_idx on public.meal_plan (guest_id);

-- The same dish once per meal, per person: two guests (or a guest and Mom)
-- can plan the same dish. "nulls not distinct" keeps the household plan
-- (guest_id null) to one of each dish per meal, as before.
do $$
begin
  if not exists (select 1 from pg_constraint
                 where conrelid = 'public.meal_plan'::regclass
                   and conname = 'meal_plan_day_meal_recipe_id_guest_id_key') then
    alter table public.meal_plan
      add constraint meal_plan_day_meal_recipe_id_guest_id_key
      unique nulls not distinct (day, meal, recipe_id, guest_id);
  end if;
end
$$;
alter table public.meal_plan drop constraint if exists meal_plan_day_meal_recipe_id_key;

drop policy if exists "Guests can read their own meal plan" on public.meal_plan;
create policy "Guests can read their own meal plan"
  on public.meal_plan for select to authenticated
  using (guest_id = (select auth.uid()) and (select public.is_guest()));

drop policy if exists "Guests can add to their own meal plan" on public.meal_plan;
create policy "Guests can add to their own meal plan"
  on public.meal_plan for insert to authenticated
  with check (guest_id = (select auth.uid()) and (select public.is_guest()));

drop policy if exists "Guests can take dishes off their own meal plan" on public.meal_plan;
create policy "Guests can take dishes off their own meal plan"
  on public.meal_plan for delete to authenticated
  using (guest_id = (select auth.uid()) and (select public.is_guest()));

-- ---------- her photos: guests may look ----------

-- Only "see" (which is what signed links need). Guests have no rule to add,
-- replace or remove photos, so they can't.
drop policy if exists "Guests can see dish photos" on storage.objects;
create policy "Guests can see dish photos"
  on storage.objects for select to authenticated
  using (bucket_id = 'dish-photos' and (select public.is_guest()));

-- ---------- the first family code ----------

-- Only when there isn't one yet, so running this again keeps the current link.
insert into private.family_code (id, code)
values (true, private.make_family_code())
on conflict (id) do nothing;

commit;
