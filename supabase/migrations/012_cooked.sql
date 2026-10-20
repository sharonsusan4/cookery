-- "I cooked this": anyone using the app (Mom, Sharon, guests) can say they
-- cooked one of Mom's recipes, with a comment, a photo, both or neither. The
-- recipe page lists what people said, and the Cooked tab shows the photos.
-- For Mom and Sharon it also replaces "I made this today" (the app still sets
-- recipes.last_cooked_at for them).
--
-- Who sees what: everyone in the app (allowed users and guests) sees every
-- post, with the poster's name. Each person can delete their own; Sharon
-- (allowed_users.admin, migration 010) can delete anyone's. Nobody can edit
-- one. Posts are only on Mom's recipes (owner is null), never on a guest's own.
--
-- The name on a post is filled in by the database, never by the phone: a
-- guest's name from public.guests, an allowed user's from the new
-- allowed_users.name. After running this, set it for Mom's and Sharon's
-- emails in Table Editor > allowed_users ("Mom" and "Sharon"). Until then
-- their posts say "Family".
--
-- Photos go in the existing private dish-photos bucket under
-- cooked/<user id>/, and only there for guests. The app makes them small on
-- the phone first, which also leaves out where they were taken.
--
-- Run it before deploying the app version with the Cooked tab. Running it
-- again does no harm. One transaction.

begin;

alter table public.allowed_users add column if not exists name text;

create table if not exists public.cooked (
  id bigint generated always as identity primary key,
  -- Mom's recipe. If one is ever deleted, its posts go with it.
  recipe_id bigint not null references public.recipes (id) on delete cascade,
  -- Who posted it. Set by the database (cooked_fill below).
  user_id uuid references auth.users (id) on delete set null,
  name text not null default '',
  member boolean not null default false, -- Mom or Sharon (allowed users), not a guest
  comment text not null default '' check (char_length(comment) <= 1000),
  -- A path in the dish-photos bucket (cooked/<user id>/<file>.jpg), or null.
  photo_path text,
  created_at timestamptz not null default now()
);

create index if not exists cooked_recipe_id_idx on public.cooked (recipe_id);
create index if not exists cooked_created_at_idx on public.cooked (created_at desc);
create index if not exists cooked_user_id_idx on public.cooked (user_id);

-- Fills in who and when, and checks the post is on one of Mom's recipes and
-- the photo is in the poster's own folder. Only for people using the app (a
-- request with a sign-in token); the SQL Editor can still write any row as it
-- is. (current_user can't tell them apart here: in a security definer
-- function it is always the owner.)
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
  if new.photo_path is not null and new.photo_path not like 'cooked/' || uid::text || '/%' then
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
    new.member := false;
    new.name := coalesce((select g.name from public.guests g where g.user_id = uid), '');
  end if;
  return new;
end;
$$;

revoke execute on function public.cooked_fill() from public, anon, authenticated;

drop trigger if exists cooked_fill on public.cooked;
create trigger cooked_fill
  before insert on public.cooked
  for each row execute function public.cooked_fill();

alter table public.cooked enable row level security;

drop policy if exists "Everyone in the app can see posts" on public.cooked;
create policy "Everyone in the app can see posts"
  on public.cooked for select to authenticated
  using ((select public.is_allowed()) or (select public.is_guest()));

drop policy if exists "Everyone in the app can post" on public.cooked;
create policy "Everyone in the app can post"
  on public.cooked for insert to authenticated
  with check (((select public.is_allowed()) or (select public.is_guest())) and user_id = (select auth.uid()));

drop policy if exists "People delete their own posts, Sharon any" on public.cooked;
create policy "People delete their own posts, Sharon any"
  on public.cooked for delete to authenticated
  using ((user_id = (select auth.uid()) and ((select public.is_allowed()) or (select public.is_guest())))
         or (select public.is_admin()));

-- Only these three come from the phone; the trigger sets the rest. No update.
revoke all on public.cooked from anon, authenticated;
grant select, delete on public.cooked to authenticated;
grant insert (recipe_id, comment, photo_path) on public.cooked to authenticated;

-- Guests may add and remove photos in their own cooked/<user id>/ folder.
-- (Allowed users can already add and remove anything in the bucket, and
-- everyone in the app can already see it.)
drop policy if exists "Guests can add their cooked photos" on storage.objects;
create policy "Guests can add their cooked photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dish-photos' and (select public.is_guest())
              and (storage.foldername(name))[1] = 'cooked'
              and (storage.foldername(name))[2] = (select auth.uid())::text);

drop policy if exists "Guests can remove their cooked photos" on storage.objects;
create policy "Guests can remove their cooked photos"
  on storage.objects for delete to authenticated
  using (bucket_id = 'dish-photos' and (select public.is_guest())
         and (storage.foldername(name))[1] = 'cooked'
         and (storage.foldername(name))[2] = (select auth.uid())::text);

commit;
