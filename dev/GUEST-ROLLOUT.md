# Rolling out guest mode and "Shows in"

Guest mode (migration `005_guests.sql`) and per-dish meals (`006_meals.sql`) both change the real database, so do these steps in order, from the `recipe-app` folder, at a quiet time. Nothing here has been run against the real project yet.

Commands use the Supabase command-line tool through `npx` (the project is already linked; `supabase/.temp/` says so). `db query --linked` goes through Supabase's Management API, so it needs no Docker. If it asks you to log in, run `npx supabase login` first.

```bash
cd recipe-app
REF=jezkpysgzmjtitjxjtct
```

## 0. Check first (read-only)

```bash
npx supabase db query --linked --project-ref $REF "select version(), (select count(*) from public.recipes) as recipes, (select count(*) from public.allowed_users) as allowed"
```

- The version must be **PostgreSQL 15 or newer** (005 uses `unique nulls not distinct`). Every project made since 2023 is.
- Note the recipe count (about 434). You'll compare against it later.

## 1. Back up (to gitignored files)

`dev/backup/` is in `.gitignore`. These files hold her data: never commit or share them.

```bash
mkdir -p dev/backup
STAMP=$(date +%Y%m%d-%H%M)
for t in recipes shopping_items meal_plan allowed_users; do
  npx supabase db query --linked --project-ref $REF --output-format json \
    "select * from public.$t order by 1" > dev/backup/$t-$STAMP.json || echo "BACKUP OF $t FAILED"
done
ls -la dev/backup/
```

Open `dev/backup/recipes-$STAMP.json` and check it really has her recipes in it (search for a dish you know) before going on. As an extra copy, **Table Editor → recipes → Export → CSV** in the dashboard does the same.

(`npx supabase db dump --linked --data-only` would also work, but it runs `pg_dump` in Docker.)

## 2. Run the migrations

Both are idempotent: running one twice does no harm. 005 is one transaction, so it goes in completely or not at all.

```bash
npx supabase db query --linked --project-ref $REF -f supabase/migrations/005_guests.sql
npx supabase db query --linked --project-ref $REF -f supabase/migrations/006_meals.sql
```

(Or paste each file into **SQL Editor → New query → Run**.)

At this point the live app (the old version) still works for Mom. It doesn't ask for the new columns, and every existing row has `owner` / `guest_id` / `meals` null.

## 3. Check the rules (rolled back, changes nothing)

```bash
npx supabase db query --linked --project-ref $REF -f dev/guest-rls-test.sql
```

The script starts with `begin;` and ends with `rollback;`. It never commits, so its test users, rows and the extra family code all vanish. It pretends to be an allowed user (the first email in `allowed_users`), two guests and an anonymous stranger, and checks what each can see and change.

- **Passed**: it finishes without an error (the last result reads `ALL GUEST CHECKS PASSED`, if the tool shows it).
- **Failed**: it stops with `FAIL: …` and rolls back. Don't go on; see "If something breaks".

If it fails on `insert into auth.users`, the database user can't add test users. Paste the file into **SQL Editor** instead, which runs as `postgres`.

Then compare counts (the same as in step 0, and nothing new):

```bash
npx supabase db query --linked --project-ref $REF "select (select count(*) from public.recipes) recipes, (select count(*) from public.recipes where owner is not null) guest_recipes, (select count(*) from public.guests) guests"
```

## 4. Switch on anonymous sign-ins (dashboard)

1. **Authentication → Sign In / Providers**, turn on **Allow anonymous sign-ins**, and click **Save**.
2. **Watch out:** Supabase refuses anonymous sign-ins while **Allow new users to sign up** is off, because it counts each one as a sign-up. The README told you to switch that off. If the family link says *"Guest mode isn't switched on yet"* after step 5, turn **Allow new users to sign up** back on. That's safe for her data: someone who signs up with an email is neither on `allowed_users` nor a guest, so the rules give them nothing. Keep **Confirm email** on so such accounts can't even sign in unconfirmed.
3. **CAPTCHA: don't switch it on yet.** Supabase's CAPTCHA protection (Authentication → Attack Protection) applies to *every* sign-in, including Mom's email and password, and this app doesn't send a CAPTCHA token yet. Turning it on would lock everyone out. It needs a small app change first (an hCaptcha or Turnstile widget on the sign-in and welcome screens).
4. **Rate limits:** Supabase allows by default **30 anonymous sign-ins per hour per IP address** (Authentication → Rate Limits → "anonymous users"). That's plenty for family, but a group joining from one home Wi-Fi in one go could hit it. They'd see *"Too many people tried just now"*, and waiting a few minutes fixes it. On top of that, `join_family()` refuses after 10 wrong codes in 15 minutes from one anonymous session.

## 5. Deploy

Commit and push to `main` (or merge the branch). Vercel publishes in about a minute. The new service worker cache is `recipes-v18`, so phones pick up the new files on their next open with internet.

Don't deploy before step 2: the new app asks for `owner`, `guest_id` and `meals`, and Mom's recipes wouldn't load without them.

## 6. Check Mom's account still works

On your own phone or computer, open https://cookery-five.vercel.app and sign in as yourself:

- Recipes shows her recipes (the count from step 0, as before).
- Today, Plan and List look the same as before. "Visitors · Sign out" is at the bottom of Today.
- A recipe page has everything (status, notes, photo, "I made this today") plus "Shows in: … · Change".
- Then glance at Mom's phone: it should open straight into "Yo Mom" as usual.

## 7. Create the first family link

1. Today → **Visitors** (at the bottom).
2. Under **Family link** there's already a link (005 made a random code). **Copy** it, or **Share** (opens WhatsApp on Android).
3. Try it yourself first in a private/incognito window: the welcome says *"What's your name?"*. Type a name, tap **Continue as guest**, check you land on "Yo <name>", then **Leave guest mode** at the bottom of Today.
4. Send it to the family. If a link ever goes somewhere it shouldn't, **Make a new link**: the old one stops letting anyone new in, and people already in stay in. To shut someone out, **Remove** them on Visitors.

## If something breaks

**The app is the problem (database fine):** Vercel → the project → **Deployments** → the previous deployment → **⋯ → Instant Rollback**. Note that the old app doesn't know about guests: once there are guest rows, it would show Mom guests' recipes, plan and list rows next to hers. So if you roll the app back for more than a moment, also switch **Allow anonymous sign-ins** off, and consider undoing 005 (below).

**Undo 006** (only after the app is rolled back; it forgets any "Shows in" choices):

```sql
alter table public.recipes drop column if exists meals;
```

**Undo 005** (only after the app is rolled back). Guests' recipes, plan and list rows are deleted; Mom's are untouched. Paste into SQL Editor:

```sql
begin;
-- Rules first (they use is_guest() and the new columns).
drop policy if exists "Guests can see dish photos" on storage.objects;
drop policy if exists "Guests can read family and own recipes" on public.recipes;
drop policy if exists "Guests can add their own recipes" on public.recipes;
drop policy if exists "Guests can change their own recipes" on public.recipes;
drop policy if exists "Guests can delete their own recipes" on public.recipes;
drop policy if exists "Guests can read their own shopping list" on public.shopping_items;
drop policy if exists "Guests can add to their own shopping list" on public.shopping_items;
drop policy if exists "Guests can tick their own shopping list" on public.shopping_items;
drop policy if exists "Guests can clear their own shopping list" on public.shopping_items;
drop policy if exists "Guests can read their own meal plan" on public.meal_plan;
drop policy if exists "Guests can add to their own meal plan" on public.meal_plan;
drop policy if exists "Guests can take dishes off their own meal plan" on public.meal_plan;
drop policy if exists "Allowed users can see guests" on public.guests;

-- Guests' rows.
delete from public.meal_plan where guest_id is not null;
delete from public.shopping_items where guest_id is not null;
delete from public.recipes where owner is not null;

-- Back to "no deleting recipes" and the old one-dish-per-meal rule.
drop trigger if exists recipes_keep_family on public.recipes;
drop function if exists public.keep_family_recipes();
revoke delete on public.recipes from authenticated;
alter table public.meal_plan drop constraint if exists meal_plan_day_meal_recipe_id_guest_id_key;
alter table public.meal_plan add constraint meal_plan_day_meal_recipe_id_key unique (day, meal, recipe_id);

alter table public.meal_plan drop column if exists guest_id;
alter table public.shopping_items drop column if exists guest_id;
alter table public.recipes drop column if exists owner;

drop function if exists public.join_family(text, text);
drop function if exists public.touch_guest();
drop function if exists public.new_family_code();
drop function if exists public.get_family_code();
drop function if exists public.remove_guest(uuid);
drop function if exists public.is_guest();
drop table if exists public.guests;
drop schema if exists private cascade;
commit;
```

Then switch **Allow anonymous sign-ins** off (and **Allow new users to sign up** off again if you turned it on). Old anonymous users can be deleted under **Authentication → Users** (filter by anonymous).

**Her data itself looks wrong:** stop and don't write anything more. The backups from step 1 are in `dev/backup/` (JSON, one object per row). Compare before restoring anything; a restore is a careful `update`/`insert` per row, not a bulk overwrite.

## Later, now and then

- Anonymous users pile up a little: each failed join and each "Leave guest mode" leaves one behind. **Authentication → Users**, filter anonymous, and delete old ones. Deleting a guest's user also deletes their guest row and everything they added (the foreign keys cascade).
- A removed guest's rows stay, hidden from everyone, in case they come back on the same phone with a current link. Deleting their anonymous user clears them.
