-- Like notices in the app: a dot on the round initial (top of Today and
-- Cooked) when someone liked one of your posts since you last looked, and
-- "Likes on your posts" on the You page. "Since you last looked" is kept per
-- person here, so it's the same on every phone they use.
--
-- Only adds a table and a function. Each person reads only their own row and
-- changes it only through mark_likes_seen(). Run it before deploying the app
-- version with the notices (sw recipes-v37); the older app ignores it.
-- Running it again does no harm. One transaction.

begin;

create table if not exists public.notice_marks (
  user_id uuid primary key references auth.users (id) on delete cascade,
  likes_seen_at timestamptz not null default now()
);

alter table public.notice_marks enable row level security;
revoke all on public.notice_marks from anon, authenticated;
grant select on public.notice_marks to authenticated;

drop policy if exists "People read their own marks" on public.notice_marks;
create policy "People read their own marks"
  on public.notice_marks for select to authenticated
  using (user_id = (select auth.uid()));

-- "I've seen my likes": now, for whoever is signed in (Mom, Sharon or a guest).
create or replace function public.mark_likes_seen() returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  seen timestamptz := now();
begin
  if uid is null or not (public.is_allowed() or public.is_guest()) then
    return null;
  end if;
  insert into public.notice_marks as m (user_id, likes_seen_at) values (uid, seen)
  on conflict (user_id) do update set likes_seen_at = excluded.likes_seen_at;
  return seen;
end;
$$;

revoke execute on function public.mark_likes_seen() from public, anon;
grant execute on function public.mark_likes_seen() to authenticated;

commit;
