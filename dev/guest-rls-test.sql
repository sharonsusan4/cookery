-- Checks the guest rules (supabase/migrations/005_guests.sql) against the real
-- database WITHOUT changing anything: it all runs in one transaction that
-- ends in ROLLBACK, so the test users, rows and codes it makes are thrown away.
--
--   npx supabase db query --linked --project-ref jezkpysgzmjtitjxjtct -f dev/guest-rls-test.sql
--
-- (or paste it into SQL Editor). It pretends to be four people by setting the
-- request's JWT claims and switching to the "authenticated" role, the way
-- PostgREST does:
--   member   an allowed user (the first email in allowed_users)
--   guest A  an anonymous user who joins with the current code
--   guest B  a second anonymous user who joins too
--   stranger an anonymous user who never joins
-- Any failed check stops it with "FAIL: …". The last result reads
-- "ALL GUEST CHECKS PASSED" when everything is right.
-- Run it after both 005_guests.sql and 006_meals.sql (it also checks who may
-- set recipes.meals). It holds no recipes, names or codes, so it is safe to
-- commit (.gitignore lets this one .sql file in dev/ through).

begin;

-- ---------- fixtures (as the database owner) ----------

insert into auth.users (id, aud, role, is_anonymous) values
  ('00000000-0000-4000-8000-00000000000a', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-00000000000b', 'authenticated', 'authenticated', true),
  ('00000000-0000-4000-8000-00000000000c', 'authenticated', 'authenticated', true);

do $$
declare
  member text := (select email from public.allowed_users order by email limit 1);
begin
  if member is null then raise exception 'FAIL: allowed_users is empty'; end if;
  if (select count(*) from public.recipes where owner is null) = 0 then raise exception 'FAIL: no family recipes to test with'; end if;
  perform set_config('test.member', member, true);
  perform set_config('test.code', (select code from private.family_code where id), true);
  perform set_config('test.family', (select count(*) from public.recipes where owner is null)::text, true);
  perform set_config('test.photos', (select count(*) from storage.objects where bucket_id = 'dish-photos')::text, true);
  perform set_config('test.mom_recipe', (select min(id) from public.recipes where owner is null)::text, true);
  perform set_config('test.household_shop', (select count(*) from public.shopping_items where guest_id is null)::text, true);
  perform set_config('test.household_plan', (select count(*) from public.meal_plan where guest_id is null)::text, true);
end
$$;

-- ---------- the stranger: anonymous, never joined ----------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated","email":"","is_anonymous":true}', true);
set local role authenticated;

do $$
declare
  denied boolean;
begin
  if (select count(*) from public.recipes) <> 0 then raise exception 'FAIL: stranger can see recipes'; end if;
  if (select count(*) from public.shopping_items) <> 0 then raise exception 'FAIL: stranger can see the shopping list'; end if;
  if (select count(*) from public.meal_plan) <> 0 then raise exception 'FAIL: stranger can see the meal plan'; end if;
  if (select count(*) from public.guests) <> 0 then raise exception 'FAIL: stranger can see guests'; end if;
  if (select count(*) from storage.objects where bucket_id = 'dish-photos') <> 0 then raise exception 'FAIL: stranger can see photos'; end if;
  if public.is_guest() then raise exception 'FAIL: stranger counts as a guest'; end if;
  if public.touch_guest() is not null then raise exception 'FAIL: touch_guest gave the stranger a name'; end if;

  denied := false;
  begin
    insert into public.shopping_items (item, guest_id) values ('test', '00000000-0000-4000-8000-00000000000c');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'FAIL: stranger could add to a shopping list'; end if;

  denied := false;
  begin
    insert into public.recipes (link, owner) values ('https://example.com/test', '00000000-0000-4000-8000-00000000000c');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'FAIL: stranger could add a recipe'; end if;

  denied := false;
  begin perform public.new_family_code(); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: stranger could make a family code'; end if;

  denied := false;
  begin perform public.get_family_code(); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: stranger could read the family code'; end if;

  denied := false;
  begin perform count(*) from private.family_code; exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: stranger could read private.family_code'; end if;

  if public.join_family('wrong-code-123', 'Stranger') then raise exception 'FAIL: a wrong code let the stranger in'; end if;
  if public.is_guest() then raise exception 'FAIL: wrong code made a guest'; end if;
  raise notice 'ok: stranger sees and changes nothing; a wrong code is refused';
end
$$;

-- ---------- guest A joins ----------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","email":"","is_anonymous":true}', true);
set local role authenticated;

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-00000000000a';
  b constant uuid := '00000000-0000-4000-8000-00000000000b';
  mom_recipe bigint := current_setting('test.mom_recipe')::bigint;
  mine bigint;
  n int;
  denied boolean;
begin
  if not public.join_family(upper(current_setting('test.code')), E'  Test \n  guest A   ') then
    raise exception 'FAIL: guest A could not join with the current code';
  end if;
  if not public.is_guest() then raise exception 'FAIL: guest A is not a guest after joining'; end if;
  if public.touch_guest() is distinct from 'Test guest A' then raise exception 'FAIL: name not tidied: %', public.touch_guest(); end if;
  if (select count(*) from public.guests) <> 0 then raise exception 'FAIL: guest can read the guest list'; end if;

  -- Mom's recipes: all of them, read only.
  if (select count(*) from public.recipes) <> current_setting('test.family')::int then raise exception 'FAIL: guest A doesn''t see exactly the family recipes'; end if;
  update public.recipes set name = name where id = mom_recipe;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: guest A changed a family recipe'; end if;
  update public.recipes set owner = a where id = mom_recipe;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: guest A took over a family recipe'; end if;
  delete from public.recipes where id = mom_recipe;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: guest A deleted a family recipe'; end if;

  -- Their own recipe.
  insert into public.recipes (name, link, link_key, owner) values ('Guest A test dish', 'https://example.com/a', 'example.com/a', a) returning id into mine;
  perform set_config('test.a_recipe', mine::text, true);
  update public.recipes set notes = 'mine' where id = mine;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: guest A could not change their own recipe'; end if;
  update public.recipes set meals = array['Lunch'] where id = mine;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: guest A could not choose meals for their own recipe'; end if;

  denied := false;
  begin update public.recipes set owner = null where id = mine; exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: guest A could hand their recipe to the family'; end if;

  denied := false;
  begin insert into public.recipes (link) values ('https://example.com/no-owner'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: guest A added a family recipe'; end if;

  denied := false;
  begin insert into public.recipes (link, owner) values ('https://example.com/as-b', b); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: guest A added a recipe as someone else'; end if;

  -- Shopping list and plan: only rows marked as theirs.
  insert into public.shopping_items (item, recipe_id, guest_id) values ('test item', mom_recipe, a);
  insert into public.meal_plan (day, meal, recipe_id, guest_id) values ('2099-01-01', 'Lunch', mom_recipe, a);
  if (select count(*) from public.shopping_items) <> 1 then raise exception 'FAIL: guest A sees other shopping rows'; end if;
  if (select count(*) from public.meal_plan) <> 1 then raise exception 'FAIL: guest A sees other plan rows'; end if;

  denied := false;
  begin insert into public.shopping_items (item) values ('household'); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: guest A added to the household list'; end if;

  denied := false;
  begin insert into public.meal_plan (day, meal, recipe_id) values ('2099-01-02', 'Lunch', mom_recipe); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: guest A added to the household plan'; end if;

  denied := false;
  begin insert into public.shopping_items (item, guest_id) values ('as b', b); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: guest A added to guest B''s list'; end if;

  -- Photos: see, never change.
  if (select count(*) from storage.objects where bucket_id = 'dish-photos') <> current_setting('test.photos')::int then
    raise exception 'FAIL: guest A doesn''t see the dish photos';
  end if;
  denied := false;
  begin
    insert into storage.objects (bucket_id, name) values ('dish-photos', 'guest-test/x.jpg');
  exception when others then denied := true;
  end;
  if not denied then raise exception 'FAIL: guest A could add a photo'; end if;
  -- Zero rows touched, or refused outright (Storage may block direct SQL changes): both are fine.
  denied := false;
  begin
    update storage.objects set name = name where bucket_id = 'dish-photos';
    get diagnostics n = row_count;
    denied := n = 0;
  exception when others then denied := true;
  end;
  if not denied then raise exception 'FAIL: guest A could change a photo'; end if;
  denied := false;
  begin
    delete from storage.objects where bucket_id = 'dish-photos';
    get diagnostics n = row_count;
    denied := n = 0;
  exception when others then denied := true;
  end;
  if not denied then raise exception 'FAIL: guest A could delete a photo'; end if;

  -- Allowed-user functions.
  denied := false;
  begin perform public.new_family_code(); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: guest A could make a family code'; end if;
  denied := false;
  begin perform public.get_family_code(); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: guest A could read the family code'; end if;
  denied := false;
  begin perform public.remove_guest(b); exception when others then denied := true; end;
  if not denied then raise exception 'FAIL: guest A could remove a guest'; end if;

  raise notice 'ok: guest A reads family recipes and photos, keeps their own rows, changes nothing of Mom''s';
end
$$;

-- ---------- guest B joins ----------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated","email":"","is_anonymous":true}', true);
set local role authenticated;

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-00000000000a';
  b constant uuid := '00000000-0000-4000-8000-00000000000b';
  mom_recipe bigint := current_setting('test.mom_recipe')::bigint;
  a_recipe bigint := current_setting('test.a_recipe')::bigint;
  n int;
begin
  if not public.join_family(current_setting('test.code'), 'Test guest B') then raise exception 'FAIL: guest B could not join'; end if;
  if (select count(*) from public.recipes) <> current_setting('test.family')::int then raise exception 'FAIL: guest B sees more than the family recipes'; end if;
  if exists (select 1 from public.recipes where id = a_recipe) then raise exception 'FAIL: guest B sees guest A''s recipe'; end if;
  if (select count(*) from public.shopping_items) <> 0 then raise exception 'FAIL: guest B sees guest A''s list'; end if;
  if (select count(*) from public.meal_plan) <> 0 then raise exception 'FAIL: guest B sees guest A''s plan'; end if;

  update public.recipes set name = 'taken' where id = a_recipe;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: guest B changed guest A''s recipe'; end if;
  delete from public.shopping_items where guest_id = a;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: guest B cleared guest A''s list'; end if;

  -- The same dish on the same day and meal as guest A: fine, it's B's own plan.
  insert into public.meal_plan (day, meal, recipe_id, guest_id) values ('2099-01-01', 'Lunch', mom_recipe, b);
  raise notice 'ok: guest B sees only family recipes and their own rows, and can plan the same dish as A';
end
$$;

-- ---------- the member (Mom or Sharon) ----------

reset role;
select set_config('request.jwt.claims',
  json_build_object('sub', '00000000-0000-4000-8000-0000000000ff', 'role', 'authenticated',
                    'email', current_setting('test.member'), 'is_anonymous', false)::text, true);
set local role authenticated;

do $$
declare
  a constant uuid := '00000000-0000-4000-8000-00000000000a';
  b constant uuid := '00000000-0000-4000-8000-00000000000b';
  mom_recipe bigint := current_setting('test.mom_recipe')::bigint;
  fresh text;
  n int;
  denied boolean;
begin
  if not public.is_allowed() then raise exception 'FAIL: member is not allowed'; end if;
  if public.is_guest() then raise exception 'FAIL: member counts as a guest'; end if;
  if public.join_family(current_setting('test.code'), 'Mom') then raise exception 'FAIL: a member became a guest'; end if;

  -- What the app asks for: family rows only, unchanged.
  if (select count(*) from public.recipes where owner is null) <> current_setting('test.family')::int then raise exception 'FAIL: member lost family recipes'; end if;
  if (select count(*) from public.shopping_items where guest_id is null) <> current_setting('test.household_shop')::int then raise exception 'FAIL: household list changed'; end if;
  if (select count(*) from public.meal_plan where guest_id is null) <> current_setting('test.household_plan')::int then raise exception 'FAIL: household plan changed'; end if;

  -- Household plan still keeps one of each dish per meal.
  insert into public.meal_plan (day, meal, recipe_id) values ('2099-01-01', 'Lunch', mom_recipe);
  denied := false;
  begin insert into public.meal_plan (day, meal, recipe_id) values ('2099-01-01', 'Lunch', mom_recipe); exception when unique_violation then denied := true; end;
  if not denied then raise exception 'FAIL: household plan took the same dish twice'; end if;

  -- Still no deleting family recipes, even with the new delete permission.
  delete from public.recipes where id = mom_recipe;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: member deleted a family recipe'; end if;
  update public.recipes set meals = array['Lunch'] where id = mom_recipe;
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: member could not choose meals for a family recipe'; end if;

  -- Visitors page.
  if (select count(*) from public.guests where user_id in (a, b)) <> 2 then raise exception 'FAIL: member doesn''t see both guests'; end if;
  if public.get_family_code() is distinct from current_setting('test.code') then raise exception 'FAIL: get_family_code gave the wrong code'; end if;
  fresh := public.new_family_code();
  if fresh !~ '^[abcdefghjkmnpqrstuvwxyz23456789]{12}$' then raise exception 'FAIL: odd new code %', fresh; end if;
  if fresh = current_setting('test.code') or public.get_family_code() <> fresh then raise exception 'FAIL: new code not stored'; end if;
  perform set_config('test.new_code', fresh, true);
  if not public.remove_guest(b) then raise exception 'FAIL: remove_guest(B) found nothing'; end if;
  raise notice 'ok: member sees family rows as before, sees guests, makes a new code, removes guest B';
end
$$;

-- ---------- after the new code: old code refused, removed guest sees nothing ----------

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated","email":"","is_anonymous":true}', true);
set local role authenticated;

do $$
begin
  if public.join_family(current_setting('test.code'), 'Late') then raise exception 'FAIL: the old code still lets new people in'; end if;
  raise notice 'ok: the old code no longer lets anyone new in';
end
$$;

reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated","email":"","is_anonymous":true}', true);
set local role authenticated;

do $$
begin
  if public.is_guest() then raise exception 'FAIL: removed guest B is still a guest'; end if;
  if (select count(*) from public.recipes) <> 0 then raise exception 'FAIL: removed guest B still sees recipes'; end if;
  if (select count(*) from public.meal_plan) <> 0 then raise exception 'FAIL: removed guest B still sees their plan'; end if;
  if public.touch_guest() is not null then raise exception 'FAIL: touch_guest still knows removed guest B'; end if;
  raise notice 'ok: removed guest B sees nothing';
end
$$;

-- Guest A, still in: "Leave guest mode" deletes their own rows.
reset role;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated","email":"","is_anonymous":true}', true);
set local role authenticated;

do $$
declare
  n int;
begin
  if not public.is_guest() then raise exception 'FAIL: guest A dropped out when the code changed'; end if;
  delete from public.meal_plan where guest_id = '00000000-0000-4000-8000-00000000000a';
  delete from public.shopping_items where guest_id = '00000000-0000-4000-8000-00000000000a';
  delete from public.recipes where owner = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: guest A could not delete their own recipe'; end if;
  raise notice 'ok: guest A stays in after a new code, and can clear their own rows';
end
$$;

reset role;
select 'ALL GUEST CHECKS PASSED' as result;

rollback;
