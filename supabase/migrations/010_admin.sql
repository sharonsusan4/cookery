-- Only Sharon sees who came in: the guest list on the Visitors page, and
-- removing a guest. Mom stays an allowed user for everything else, including
-- the family code (see, change, make new), but no longer sees visitors.
--
-- Adds allowed_users.admin (false for everyone by default) and is_admin(),
-- and switches the guests table's read rule and remove_guest() from
-- is_allowed() to is_admin(). The family-code functions are unchanged.
-- Whose emails are admins is data, not schema, so it isn't in this file (it's
-- a public repo): after running this, set admin = true for Sharon's email(s)
-- in Table Editor > allowed_users, or with an update in SQL Editor. Until
-- then nobody sees the guest list.
--
-- Run it before deploying the app version that asks is_admin(). Running it
-- again does no harm.

begin;

alter table public.allowed_users add column if not exists admin boolean not null default false;

-- True when the signed-in person is on the allowed list and marked admin.
create or replace function public.is_admin() returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_users
    where lower(trim(email)) = lower(auth.jwt() ->> 'email') and admin
  );
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- The guest list: Sharon only.
drop policy if exists "Allowed users can see guests" on public.guests;
drop policy if exists "Admins can see guests" on public.guests;
create policy "Admins can see guests"
  on public.guests for select to authenticated
  using ((select public.is_admin()));

create or replace function public.remove_guest(guest uuid) returns boolean
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
  return found;
end;
$$;

commit;
