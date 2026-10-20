-- Fixes from the security check of 15 Oct 2026 (the report is kept privately,
-- in the gitignored dev/security/). Only tightens rules and adds limits and
-- functions: no row of anyone's data is removed or changed by running this.
--
--  1. Joining: a right family code always gets in. Wrong codes are limited per
--     device (its network address) and per session; only a flood from many
--     places (300 wrong codes in an hour) pauses joining. Before, 30 wrong
--     codes from anyone stopped everyone, right code or not.
--  3. Mom's and Sharon's accounts reach only the household's own rows: Mom's
--     recipes (owner is null) and the household plan and list (guest_id is
--     null), never a guest's. The People page gets its numbers from
--     guest_counts() (admin only) instead.
--  4. remove_guest() can also delete what that person posted and liked
--     (returns the photo paths so the app removes the files).
--  5. Nobody sets a recipe's id (or owner afterwards) through the API, so a
--     guest can't take the numbers Mom's next recipes would get.
--  6. A guest can post at most 20 times a day, and nobody can join or rename
--     themselves to Mom's or Sharon's name.
--  7. Size and count limits on what guests store, and photos of at most 1.5 MB
--     (the app makes them about 0.2 MB) with at most 100 per guest.
--  Smaller: start_handover refuses the account's own name and finish_handover
--  moves only likes on moved posts (9); links must start with http(s) (10);
--  no TRUNCATE/REFERENCES/TRIGGER for the app's roles (12); strict photo
--  paths on posts (17); leave_guest() takes a guest off the list when they
--  leave (15); family_recipes() leaves out what Mom removed (19).
--
-- Run it before deploying the app version that uses guest_counts(),
-- remove_guest(guest, with_posts) and leave_guest() (sw recipes-v36); the older
-- app keeps working with it, except that Sharon's People page shows no plan
-- or recipe counts until the new app is in. Running it again does no harm.
-- One transaction.

begin;

-- ---------- 1. joining ----------

alter table private.join_failures add column if not exists ip text;
create index if not exists join_failures_ip_at_idx on private.join_failures (ip, at);

-- The caller's network address as Supabase's gateway (Cloudflare) passes it on,
-- or null when there is none (e.g. the SQL Editor).
create or replace function private.client_ip() returns text
language sql
stable
set search_path = ''
as $$
  select nullif(trim(coalesce(
    (nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip'),
    (nullif(current_setting('request.headers', true), '')::json ->> 'x-real-ip'),
    split_part(nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for', ',', 1)
  )), '');
$$;

revoke execute on function private.client_ip() from public, anon, authenticated;

-- Names nobody can join or rename to: Mom's and Sharon's (allowed_users.name).
create or replace function private.member_name_taken(candidate text) returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users a
    where nullif(trim(a.name), '') is not null and lower(trim(a.name)) = lower(trim(candidate))
  );
$$;

revoke execute on function private.member_name_taken(text) from public, anon, authenticated;

create or replace function public.join_family(code text, name text) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  caller_ip text := private.client_ip();
  current_code text;
  clean_name text;
begin
  if uid is null or public.is_allowed() then
    return false;
  end if;

  -- Wrong codes from this session, or from this device's network address,
  -- stop that session or device trying for a while. Nobody else is affected.
  if (select count(*) from private.join_failures f
      where f.user_id = uid and f.at > now() - interval '15 minutes') >= 10 then
    return false;
  end if;
  if caller_ip is not null and (select count(*) from private.join_failures f
      where f.ip = caller_ip and f.at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong family codes from this phone. Try again in an hour.' using errcode = 'P0001';
  end if;

  select fc.code into current_code from private.family_code fc where fc.id;

  -- Compared as hashes, so how long the comparison takes says nothing about the code.
  if current_code is null or
     sha256(convert_to(private.clean_family_code(join_family.code), 'UTF8')) <>
     sha256(convert_to(private.clean_family_code(current_code), 'UTF8')) then
    insert into private.join_failures (user_id, ip) values (uid, caller_ip);
    delete from private.join_failures f where f.at < now() - interval '1 day';
    -- A flood of wrong codes from many places: someone is guessing. Wrong
    -- codes pause for an hour; the right code still gets in (it's checked above).
    if (select count(*) from private.join_failures f where f.at > now() - interval '1 hour') >= 300 then
      raise exception 'Too many wrong family codes just now. Try again later.' using errcode = 'P0001';
    end if;
    return false;
  end if;

  clean_name := trim(left(trim(regexp_replace(coalesce(join_family.name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 40));
  if clean_name = '' then
    return false;
  end if;
  if private.member_name_taken(clean_name) then
    raise exception 'That name is taken. Add your surname or a nickname.' using errcode = '22023';
  end if;

  insert into public.guests as g (user_id, name)
  values (uid, clean_name)
  on conflict (user_id) do update set name = excluded.name, last_seen = now();
  return true;
end;
$$;

revoke execute on function public.join_family(text, text) from public, anon;
grant execute on function public.join_family(text, text) to authenticated;

-- ---------- 3. Mom's and Sharon's accounts: the household's rows only ----------

drop policy if exists "Allowed users can read recipes" on public.recipes;
create policy "Allowed users can read recipes"
  on public.recipes for select to authenticated
  using (owner is null and (select public.is_allowed()));

drop policy if exists "Allowed users can add recipes" on public.recipes;
create policy "Allowed users can add recipes"
  on public.recipes for insert to authenticated
  with check (owner is null and (select public.is_allowed()));

drop policy if exists "Allowed users can change recipes" on public.recipes;
create policy "Allowed users can change recipes"
  on public.recipes for update to authenticated
  using (owner is null and (select public.is_allowed()))
  with check (owner is null and (select public.is_allowed()));

drop policy if exists "Allowed users can read the shopping list" on public.shopping_items;
create policy "Allowed users can read the shopping list"
  on public.shopping_items for select to authenticated
  using (guest_id is null and (select public.is_allowed()));
drop policy if exists "Allowed users can add to the shopping list" on public.shopping_items;
create policy "Allowed users can add to the shopping list"
  on public.shopping_items for insert to authenticated
  with check (guest_id is null and (select public.is_allowed()));
drop policy if exists "Allowed users can tick the shopping list" on public.shopping_items;
create policy "Allowed users can tick the shopping list"
  on public.shopping_items for update to authenticated
  using (guest_id is null and (select public.is_allowed()))
  with check (guest_id is null and (select public.is_allowed()));
drop policy if exists "Allowed users can clear the shopping list" on public.shopping_items;
create policy "Allowed users can clear the shopping list"
  on public.shopping_items for delete to authenticated
  using (guest_id is null and (select public.is_allowed()));

drop policy if exists "Allowed users can read the meal plan" on public.meal_plan;
create policy "Allowed users can read the meal plan"
  on public.meal_plan for select to authenticated
  using (guest_id is null and (select public.is_allowed()));
drop policy if exists "Allowed users can add to the meal plan" on public.meal_plan;
create policy "Allowed users can add to the meal plan"
  on public.meal_plan for insert to authenticated
  with check (guest_id is null and (select public.is_allowed()));
drop policy if exists "Allowed users can take dishes off the meal plan" on public.meal_plan;
create policy "Allowed users can take dishes off the meal plan"
  on public.meal_plan for delete to authenticated
  using (guest_id is null and (select public.is_allowed()));

-- Sharon's People page: how many dishes each guest planned and recipes they
-- added, without reading the rows themselves.
create or replace function public.guest_counts()
returns table (user_id uuid, planned bigint, added bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select g.user_id,
         (select count(*) from public.meal_plan p where p.guest_id = g.user_id),
         (select count(*) from public.recipes r where r.owner = g.user_id)
  from public.guests g
  where public.is_admin();
$$;

revoke execute on function public.guest_counts() from public, anon;
grant execute on function public.guest_counts() to authenticated;

-- ---------- 4. removing a guest, and leaving ----------

-- Sharon only. Takes the guest off the list; with with_posts, also deletes
-- their posts and likes. Returns the photo paths of the deleted posts so the
-- app can remove the files (Sharon may remove any photo).
drop function if exists public.remove_guest(uuid);
create or replace function public.remove_guest(guest uuid, with_posts boolean default false)
returns setof text
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only Sharon can remove a guest' using errcode = '42501';
  end if;
  delete from public.guests g where g.user_id = remove_guest.guest;
  if with_posts then
    delete from public.cooked_likes l where l.user_id = remove_guest.guest;
    return query
      delete from public.cooked c where c.user_id = remove_guest.guest and not c.member
      returning c.photo_path;
  end if;
  return;
end;
$$;

revoke execute on function public.remove_guest(uuid, boolean) from public, anon;
grant execute on function public.remove_guest(uuid, boolean) to authenticated;

-- A guest leaving guest mode takes themselves off the list (their posts stay).
create or replace function public.leave_guest() returns boolean
language sql
volatile
security definer
set search_path = ''
as $$
  delete from public.guests g where g.user_id = (select auth.uid()) returning true;
$$;

revoke execute on function public.leave_guest() from public, anon;
grant execute on function public.leave_guest() to authenticated;

-- ---------- 5 and 12. what the API may write ----------

revoke insert, update on public.recipes from authenticated;
grant insert (name, category, status, link, link_key, source, notes, protein, ingredients,
              last_cooked_at, photo_path, effort, meals, tags, owner) on public.recipes to authenticated;
grant update (name, category, status, link, link_key, source, notes, protein, ingredients,
              last_cooked_at, photo_path, effort, meals, tags) on public.recipes to authenticated;

revoke truncate, references, trigger on all tables in schema public from anon, authenticated;

-- ---------- 7 and 10. limits on what guests store ----------

-- Links: only web addresses (checked for new and changed rows; every
-- existing link already is one).
alter table public.recipes drop constraint if exists recipes_link_web;
alter table public.recipes add constraint recipes_link_web check (link ~* '^https?://') not valid;

-- Guests' own rows: sizes, and how many each guest keeps. Mom's and Sharon's
-- rows are left as they are.
create or replace function public.guest_limits() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated') or public.is_allowed() then
    return new;
  end if;
  if tg_table_name = 'recipes' then
    if char_length(new.name) > 200 or char_length(new.category) > 100 or char_length(new.status) > 50
       or char_length(new.link) > 2000 or char_length(new.source) > 50 or char_length(new.notes) > 5000
       or coalesce(array_length(new.ingredients, 1), 0) > 100
       or exists (select 1 from unnest(coalesce(new.ingredients, '{}')) i where char_length(i) > 200)
       or coalesce(array_length(new.meals, 1), 0) > 10 or coalesce(array_length(new.tags, 1), 0) > 10 then
      raise exception 'That recipe is too long to save.' using errcode = '22001';
    end if;
    if tg_op = 'INSERT' and (select count(*) from public.recipes r where r.owner = uid) >= 300 then
      raise exception 'You have saved the most recipes a guest can.' using errcode = '54000';
    end if;
  elsif tg_table_name = 'shopping_items' then
    if char_length(new.item) > 200 then
      raise exception 'That item is too long.' using errcode = '22001';
    end if;
    if tg_op = 'INSERT' and (select count(*) from public.shopping_items s where s.guest_id = uid) >= 500 then
      raise exception 'Your list is full.' using errcode = '54000';
    end if;
  elsif tg_table_name = 'meal_plan' then
    if tg_op = 'INSERT' and (select count(*) from public.meal_plan p where p.guest_id = uid) >= 1000 then
      raise exception 'Your plan is full.' using errcode = '54000';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function public.guest_limits() from public, anon, authenticated;

drop trigger if exists recipes_guest_limits on public.recipes;
create trigger recipes_guest_limits before insert or update on public.recipes
  for each row execute function public.guest_limits();
drop trigger if exists shopping_items_guest_limits on public.shopping_items;
create trigger shopping_items_guest_limits before insert or update on public.shopping_items
  for each row execute function public.guest_limits();
drop trigger if exists meal_plan_guest_limits on public.meal_plan;
create trigger meal_plan_guest_limits before insert on public.meal_plan
  for each row execute function public.guest_limits();

-- Photos: 1.5 MB each at most, and at most 100 per guest.
update storage.buckets set file_size_limit = 1572864 where id = 'dish-photos';

drop policy if exists "Guests can add their cooked photos" on storage.objects;
create policy "Guests can add their cooked photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dish-photos' and (select public.is_guest())
              and (storage.foldername(name))[1] = 'cooked'
              and (storage.foldername(name))[2] = (select auth.uid())::text
              and (select count(*) from storage.objects o
                   where o.bucket_id = 'dish-photos' and (storage.foldername(o.name))[1] = 'cooked'
                     and (storage.foldername(o.name))[2] = (select auth.uid())::text) < 100);

-- ---------- 6 and 17. posts ----------

create or replace function public.cooked_fill() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if uid is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if not exists (select 1 from public.recipes r where r.id = new.recipe_id and r.owner is null) then
    raise exception 'Posts are only on Mom''s recipes' using errcode = '42501';
  end if;
  new.photo_path := nullif(trim(coalesce(new.photo_path, '')), '');
  if new.photo_path is not null and new.photo_path !~ ('^cooked/' || uid::text || '/[0-9]{10,16}\.jpg$') then
    raise exception 'The photo must be in your own folder' using errcode = '42501';
  end if;
  new.user_id := uid;
  new.created_at := now();
  new.comment := trim(coalesce(new.comment, ''));
  if public.is_allowed() then
    new.member := true;
    new.name := coalesce((
      select nullif(trim(a.name), '') from public.allowed_users a
      where lower(trim(a.email)) = lower(auth.jwt() ->> 'email')
      limit 1), 'Family');
  else
    if (select count(*) from public.cooked c where c.user_id = uid and c.created_at > now() - interval '1 day') >= 20 then
      raise exception 'That''s a lot of posts today. Try again tomorrow.' using errcode = '54000';
    end if;
    new.member := false;
    new.name := coalesce((select g.name from public.guests g where g.user_id = uid), '');
  end if;
  return new;
end;
$$;

revoke execute on function public.cooked_fill() from public, anon, authenticated;

create or replace function public.rename_me(name text) returns text
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  clean_name text := trim(left(trim(regexp_replace(coalesce(rename_me.name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 40));
begin
  if uid is null or public.is_allowed() or not public.is_guest() then
    return null;
  end if;
  if clean_name = '' then
    raise exception 'Type a name first.' using errcode = '22023';
  end if;
  if private.member_name_taken(clean_name) then
    raise exception 'That name is taken. Add your surname or a nickname.' using errcode = '22023';
  end if;
  update public.guests g set name = clean_name where g.user_id = uid;
  update public.cooked c set name = clean_name where c.user_id = uid and not c.member;
  update public.cooked_likes l set name = clean_name where l.user_id = uid;
  return clean_name;
end;
$$;

revoke execute on function public.rename_me(text) from public, anon;
grant execute on function public.rename_me(text) to authenticated;

-- ---------- 9. "Not Mom?" handover ----------

create or replace function public.start_handover(name text) returns uuid
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  clean_name text := trim(left(trim(regexp_replace(coalesce(start_handover.name, ''), '[[:space:][:cntrl:]]+', ' ', 'g')), 40));
  t uuid;
begin
  if auth.uid() is null or not public.is_allowed() then
    raise exception 'Only Mom''s and Sharon''s accounts can do this' using errcode = '42501';
  end if;
  if clean_name = '' then
    raise exception 'Type a name first.' using errcode = '22023';
  end if;
  if lower(clean_name) = lower(public.my_name()) or private.member_name_taken(clean_name) then
    raise exception 'Type your own name, not the account''s.' using errcode = '22023';
  end if;
  delete from private.handovers h where h.created_at < now() - interval '1 day';
  insert into private.handovers (from_user, name) values (auth.uid(), clean_name) returning token into t;
  return t;
end;
$$;

revoke execute on function public.start_handover(text) from public, anon;
grant execute on function public.start_handover(text) to authenticated;

create or replace function public.finish_handover(token uuid) returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  uid uuid := auth.uid();
  h private.handovers;
  moved integer := 0;
  guest_name text;
begin
  if uid is null or public.is_allowed() or not public.is_guest() then
    return 0;
  end if;
  select * into h from private.handovers x
  where x.token = finish_handover.token and x.used_at is null and x.created_at > now() - interval '15 minutes'
  for update;
  if not found then
    return 0;
  end if;
  update private.handovers x set used_at = now() where x.token = h.token;
  select g.name into guest_name from public.guests g where g.user_id = uid;
  with moved_posts as (
    update public.cooked c set user_id = uid, name = coalesce(guest_name, c.name)
    where c.user_id = h.from_user and not c.member and lower(trim(c.name)) = lower(h.name)
    returning c.id
  ), moved_likes as (
    update public.cooked_likes l set user_id = uid, name = coalesce(guest_name, l.name)
    where l.user_id = h.from_user and lower(trim(l.name)) = lower(h.name)
      and l.post_id in (select id from moved_posts)
    returning 1
  )
  select count(*) into moved from moved_posts;
  return moved;
end;
$$;

revoke execute on function public.finish_handover(uuid) from public, anon;
grant execute on function public.finish_handover(uuid) to authenticated;

-- ---------- 19. family_recipes(): not what Mom removed ----------

create or replace function public.family_recipes()
returns table (
  id bigint, name text, category text, status text, link text, link_key text, source text,
  ingredients text[], last_cooked_at timestamptz, photo_path text, effort text,
  meals text[], tags text[], owner uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  select r.id, r.name, r.category, r.status, r.link, r.link_key, r.source, r.ingredients,
         r.last_cooked_at, r.photo_path, r.effort, r.meals, r.tags, r.owner
  from public.recipes r
  where r.owner is null and (public.is_guest() or public.is_allowed())
    and r.status !~* '^\s*not\s+interested' and r.name !~* '\mignore\M';
$$;

revoke execute on function public.family_recipes() from public, anon;
grant execute on function public.family_recipes() to authenticated;

commit;
