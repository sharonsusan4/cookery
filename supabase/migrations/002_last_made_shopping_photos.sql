-- Adds "Last made", the shopping list and her own photos to a project that was
-- set up with the first version of supabase/schema.sql. Paste all of this into
-- Supabase > SQL Editor and click Run, once, BEFORE deploying the app version
-- that uses it (the app asks for the new columns, and would fail without them).
-- Running it again does no harm: everything is "if not exists" or checked first.
-- schema.sql already includes all of this for a brand-new project.

-- ---------- recipes: last made, her photo ----------

-- When she last cooked it (set by "How was it?" and "I made this today").
-- Null means never, as far as the app knows.
alter table public.recipes add column if not exists last_cooked_at timestamptz;

-- Her own photo of the dish: a path inside the private dish-photos bucket,
-- like "123/1760000000000.jpg". Null when she hasn't added one.
alter table public.recipes add column if not exists photo_path text;

-- ---------- shopping list ----------

create table if not exists public.shopping_items (
  id bigint generated always as identity primary key,
  item text not null,
  -- Which dish it's for; null for things she typed herself ("milk"). Recipes
  -- are never deleted, but if one ever is, its items simply move to "Other".
  recipe_id bigint references public.recipes (id) on delete set null,
  done boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists shopping_items_recipe_id_idx on public.shopping_items (recipe_id);

-- Same rule as recipes: only signed-in people on the allowed list. Unlike
-- recipes, list items may be deleted ("Clear ticked", taking something off).
alter table public.shopping_items enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shopping_items'
                 and policyname = 'Allowed users can read the shopping list') then
    create policy "Allowed users can read the shopping list"
      on public.shopping_items for select to authenticated
      using ((select public.is_allowed()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shopping_items'
                 and policyname = 'Allowed users can add to the shopping list') then
    create policy "Allowed users can add to the shopping list"
      on public.shopping_items for insert to authenticated
      with check ((select public.is_allowed()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shopping_items'
                 and policyname = 'Allowed users can tick the shopping list') then
    create policy "Allowed users can tick the shopping list"
      on public.shopping_items for update to authenticated
      using ((select public.is_allowed()))
      with check ((select public.is_allowed()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'shopping_items'
                 and policyname = 'Allowed users can clear the shopping list') then
    create policy "Allowed users can clear the shopping list"
      on public.shopping_items for delete to authenticated
      using ((select public.is_allowed()));
  end if;
end
$$;

revoke all on public.shopping_items from anon;
grant select, insert, update, delete on public.shopping_items to authenticated;

-- ---------- her photos ----------

-- Private: photos are only shown through short-lived signed links, which the
-- rules below only hand to allowed people. The app always uploads a JPEG of at
-- most 1080px, so 5 MB is far more than enough and stops anything odd.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('dish-photos', 'dish-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do nothing;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Allowed users can see dish photos') then
    create policy "Allowed users can see dish photos"
      on storage.objects for select to authenticated
      using (bucket_id = 'dish-photos' and (select public.is_allowed()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Allowed users can add dish photos') then
    create policy "Allowed users can add dish photos"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'dish-photos' and (select public.is_allowed()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Allowed users can replace dish photos') then
    create policy "Allowed users can replace dish photos"
      on storage.objects for update to authenticated
      using (bucket_id = 'dish-photos' and (select public.is_allowed()))
      with check (bucket_id = 'dish-photos' and (select public.is_allowed()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'Allowed users can remove dish photos') then
    create policy "Allowed users can remove dish photos"
      on storage.objects for delete to authenticated
      using (bucket_id = 'dish-photos' and (select public.is_allowed()));
  end if;
end
$$;
