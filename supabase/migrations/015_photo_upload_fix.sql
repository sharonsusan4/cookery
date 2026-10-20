-- Fixes photo uploads, broken by 014 for everyone (Mom, Sharon and guests):
-- the guests' photo rule counted their photos with a query on storage.objects
-- from inside a rule on storage.objects, which Postgres refuses as "infinite
-- recursion detected in policy" (the app showed "The database schema is
-- invalid or incompatible"). The count now comes from a function that reads
-- the table without going through its rules. Same limit: 100 photos a guest.
--
-- Only changes the one storage rule and adds the function. No app change.
-- Running it again does no harm. One transaction.

begin;

-- How many photos the signed-in person has in their own cooked/<id>/ folder.
create or replace function public.my_cooked_photo_count() returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select count(*) from storage.objects o
  where o.bucket_id = 'dish-photos'
    and (storage.foldername(o.name))[1] = 'cooked'
    and (storage.foldername(o.name))[2] = (select auth.uid())::text;
$$;

revoke execute on function public.my_cooked_photo_count() from public, anon;
grant execute on function public.my_cooked_photo_count() to authenticated;

drop policy if exists "Guests can add their cooked photos" on storage.objects;
create policy "Guests can add their cooked photos"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'dish-photos' and (select public.is_guest())
              and (storage.foldername(name))[1] = 'cooked'
              and (storage.foldername(name))[2] = (select auth.uid())::text
              and (select public.my_cooked_photo_count()) < 100);

commit;
