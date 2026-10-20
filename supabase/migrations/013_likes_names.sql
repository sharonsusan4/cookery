-- Likes on "I cooked this" posts, and names you can see and fix.
--
-- * cooked_likes: one row per person per post. Everyone in the app sees who
--   liked what; you add or take back only your own like. The name on a like
--   comes from the database, like the name on a post.
-- * my_name(): the name the app shows for whoever is signed in (allowed_users.name
--   for Mom and Sharon, the guest's own name for a guest), for the "You" page
--   and "Posting as …".
-- * rename_me(name): a guest fixes their own name. Their posts and likes take
--   the new name too. (Mom's and Sharon's come from allowed_users.)
-- * start_handover(name) / finish_handover(token): "Not Mom?" in the app.
--   Someone in the family using Mom's account on their own phone switches that
--   phone to their own guest account in one tap. While still on Mom's account
--   the phone asks for a handover (start_handover, allowed accounts only),
--   then signs in as a new guest with the family code and claims it
--   (finish_handover, that guest only, within 15 minutes, once): the posts on
--   Mom's account that already carry their name (not Mom's own) move to them,
--   with their likes.
--
-- Only adds things: no table, row or column is removed or emptied. Run it
-- before deploying the app version with likes and the "You" page. Running it
-- again does no harm. One transaction.

begin;

-- The signed-in person's name: '' when nobody, 'Family' for an allowed user
-- with no name set.
create or replace function public.my_name() returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  found_name text;
begin
  if uid is null then
    return '';
  end if;
  if public.is_allowed() then
    select nullif(trim(a.name), '') into found_name from public.allowed_users a
    where lower(trim(a.email)) = lower(auth.jwt() ->> 'email') limit 1;
    return coalesce(found_name, 'Family');
  end if;
  select g.name into found_name from public.guests g where g.user_id = uid;
  return coalesce(found_name, '');
end;
$$;

revoke execute on function public.my_name() from public, anon;
grant execute on function public.my_name() to authenticated;

-- A guest renames themselves: 1 to 40 characters once tidied. Returns the
-- name as saved, or null when they aren't a guest.
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
  update public.guests g set name = clean_name where g.user_id = uid;
  update public.cooked c set name = clean_name where c.user_id = uid and not c.member;
  update public.cooked_likes l set name = clean_name where l.user_id = uid;
  return clean_name;
end;
$$;

create table if not exists public.cooked_likes (
  post_id bigint not null references public.cooked (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null default '',
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create index if not exists cooked_likes_user_id_idx on public.cooked_likes (user_id);

-- Fills in who and when; only for people using the app (see cooked_fill in 012).
create or replace function public.cooked_like_fill() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(auth.jwt() ->> 'role', '') not in ('anon', 'authenticated') then
    return new;
  end if;
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  new.user_id := auth.uid();
  new.created_at := now();
  new.name := public.my_name();
  return new;
end;
$$;

revoke execute on function public.cooked_like_fill() from public, anon, authenticated;

drop trigger if exists cooked_like_fill on public.cooked_likes;
create trigger cooked_like_fill
  before insert on public.cooked_likes
  for each row execute function public.cooked_like_fill();

alter table public.cooked_likes enable row level security;

drop policy if exists "Everyone in the app can see likes" on public.cooked_likes;
create policy "Everyone in the app can see likes"
  on public.cooked_likes for select to authenticated
  using ((select public.is_allowed()) or (select public.is_guest()));

drop policy if exists "Everyone in the app can like" on public.cooked_likes;
create policy "Everyone in the app can like"
  on public.cooked_likes for insert to authenticated
  with check (((select public.is_allowed()) or (select public.is_guest())) and user_id = (select auth.uid()));

drop policy if exists "People take back their own like" on public.cooked_likes;
create policy "People take back their own like"
  on public.cooked_likes for delete to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.cooked_likes from anon, authenticated;
grant select, delete on public.cooked_likes to authenticated;
grant insert (post_id) on public.cooked_likes to authenticated;

-- ---- "Not Mom?": hand a phone over from Mom's account to its own guest ----

create table if not exists private.handovers (
  token uuid primary key default gen_random_uuid(),
  from_user uuid not null,
  name text not null,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
alter table private.handovers enable row level security;
revoke all on private.handovers from public, anon, authenticated;

-- Mom's (or Sharon's) account, on the phone that's switching: a token for
-- finish_handover(), good for 15 minutes.
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
  delete from private.handovers h where h.created_at < now() - interval '1 day';
  insert into private.handovers (from_user, name) values (auth.uid(), clean_name) returning token into t;
  return t;
end;
$$;

revoke execute on function public.start_handover(text) from public, anon;
grant execute on function public.start_handover(text) to authenticated;

-- The new guest, right after joining: moves the posts on that account that
-- carry the name they typed (not Mom's own, member = false), and those posts'
-- likes by that account, to them. Returns how many posts moved; 0 for a used,
-- old or unknown token.
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
  update public.cooked c set user_id = uid, name = coalesce(guest_name, c.name)
  where c.user_id = h.from_user and not c.member and lower(trim(c.name)) = lower(h.name);
  get diagnostics moved = row_count;
  update public.cooked_likes l set user_id = uid, name = coalesce(guest_name, l.name)
  where l.user_id = h.from_user and lower(trim(l.name)) = lower(h.name);
  return moved;
end;
$$;

revoke execute on function public.finish_handover(uuid) from public, anon;
grant execute on function public.finish_handover(uuid) to authenticated;

-- rename_me() above uses cooked_likes, so it's granted once the table exists.
revoke execute on function public.rename_me(text) from public, anon;
grant execute on function public.rename_me(text) to authenticated;

commit;
