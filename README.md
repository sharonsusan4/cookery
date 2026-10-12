# My Recipes

A small phone app for Mom's recipe collection. Her recipes live in a **Supabase** database and the app is hosted on **Vercel**. She only ever uses the app; there's no spreadsheet to keep in step any more.

What it does:
- **Share to save**: in YouTube, Instagram or Facebook, she taps Share and then Recipes. The link and source are filled in, and for YouTube the thumbnail and an English name are too.
- **Already saved warning**: it spots the same video even when the link looks different.
- **Browse**: dish tiles with search (names and notes) and filters for status and category.
- **Dish tiles**: every tile (Recipes, Today, Yo Mom) is a soft tinted square with a thin line icon for the kind of dish (meat, fish, rice, curry, bread, sweets, drinks, pickles…) and the name under it, so they all look alike. `iconFor` in `app/app.js` picks the icon from the dish name (Malayalam and Hindi words too), then the main ingredient, then the category. The icons are a few [Tabler Icons](https://tabler.io/icons) (MIT) copied into `app/icons.js`. The real picture is on the dish's own page.
- **Tap instead of typing**: under the search box, chips for her proteins, the ingredients she uses most, and Gravy / Roast / Fry / Kebab. Tapping one puts it in the search list, exactly as if she'd typed it.
- **Last made**: "Made yesterday", "Last made 3 weeks ago" on the recipe and on Today's suggestion. Set when she answers "How was it?" or taps *I made this today*. Today's suggestion leaves out what she made in the last 14 days.
- **Shopping list**: tap ingredients on a recipe to put them on the **List** tab, add her own things, tick them off, and send the list on WhatsApp. It's kept in the database, so you see the same list on your phone.
- **Plan**: the **Plan** tab plans any of the next seven days (Today, Tomorrow, then Sat 11…). Breakfast, Lunch, Snacks and Dinner always show; Desserts and Drinks once they have dishes. *+ Add dish* opens that meal's dishes as tiles: tap to put one on the plan (tap again to take it off), search for anything else, then *Done*. Tap a dish to open it, ✕ to take it off (with *Undo*). *Add ingredients to list* puts the day's ingredients on the shopping list, skipping what's already there. On a recipe, *Add to plan* puts it on today's plan under the meal that fits (*Change* moves it), and Today shows "On your plan: …" for the meal on show. It's kept in the database (`meal_plan`), so you see the same plan on your phone.
- **Back**: every screen that isn't a tab (a recipe, the add-dish picker) has *‹ Back* at the top left. It goes back the way she came, keeping her place; opened straight from a share or a fresh load, it goes to the screen above instead.
- **Her photos**: *Add my photo* on a recipe. The photo is made smaller on the phone, kept in a private storage bucket, and shown at the top of the recipe (instead of the YouTube picture).
- **Yo Mom**: each time she opens the app, nine cards are dealt and "Let’s cook…" goes once round the meals (Breakfast, Lunch, Snacks, Dinner, Desserts, Drinks), the cards turning over to that meal's dishes as icon tiles, and stops on the meal for the time of day. Then she taps *Quick & easy* or *Gourmet*. Under 3 seconds; a tap skips to the end. In the browser console, `showWelcome(new Date(2026, 0, 1, 19))` plays it as if it were 7pm.
- **Today** (the meal screen): a small "Quick & easy" over a big "Lunch ⌄" (tap it to change the meal), and a Quick & easy / Gourmet switch. One idea, as a tinted panel with the dish's icon and name (Loved a little more likely; never *Skip next time* or anything made in the last 14 days), then every dish of that meal and kind, then a few things *On the side* (drinks, chutneys, snacks) for that meal. The meals and their categories are `MEALS` in `app/app.js`.
- **Quick & easy / Gourmet** come from the `effort` column: `quick`, `gourmet`, `storage` (pickles, pastes, batters: only ever in the Recipes tab) or empty for everyday dishes, which count as Quick & easy. It can't be changed in the app yet; set it in **Table Editor**.
- **Remove**: sets the status to *Not Interested*. Nothing is ever deleted. Recipes she named "ignore" are hidden as well.
- **Shows in**: under a recipe's category, "Shows in: Lunch, Dinner · Change". Change opens the six meals as toggles; each tap saves straight away ("Now shows in Lunch"), at least one stays on, and *Reset to category* goes back to the category's meals. Today, the first page, suggestions, the Plan picker and *Add to plan* all follow it. Whether a dish is a main dish or *On the side* for a meal still follows its category. Kept in `recipes.meals` (null = the category's meals).
- **Guest mode**: family members open the plain address and type their name and the secret **family code**, no email and no password. They tap *Continue as guest*, and the first page says "Yo <name>". Sharon sets the code on **Visitors** (short and easy to remember, 6 to 40 characters) and shares it from there. Old family links (`…/#join=<code>`) still work while their code is current; they only ask for a name. They see Mom's recipes (name, category, "Mom loved this", ingredients, picture, the link), but nothing that would change hers and none of her notes. They have their own plan, shopping list and recipes (marked *Yours*), which Mom never sees. *Leave guest mode* at the bottom of Today ends it on that phone (and deletes their plan, list and recipes). An old link's code travels after the `#`, so it never reaches a server log, and it's taken out of the address as soon as they're in.
- **Visitors** (Mom and you only): a quiet link next to *Sign out* on Today. It lists who came in, when they first and last visited, and what they planned or added. *Remove* (with *Undo*) shuts someone out. *Family code* shows the code in large letters with *Copy* and *Share* (WhatsApp on Android; the message says to open the app address and tap *Continue as guest*). *Change code* sets one you choose; *Make a new code* makes a random one. Either stops the old code letting anyone new in. At the bottom: the `#signin` address, for signing in on a new phone.

```
app/          the phone app (plain files; this is what Vercel serves)
api/meta.js   tiny Vercel function that looks up YouTube titles
supabase/     the database setup (schema.sql, and migrations/ for changes to an existing project)
dev/          local test server, pretend database, and the import script
```

## Set it up (once)

You'll need about half an hour. Do the steps in order.

### 1. Create the Supabase project

1. Go to https://supabase.com, sign up (free), and click **New project**.
2. Name it `recipes`, make up a database password (save it in your password manager; the app doesn't need it), and pick the region **South Asia (Mumbai)**. Click **Create**.
3. When it's ready, open **SQL Editor** in the left menu, click **New query**, paste in everything from [supabase/schema.sql](supabase/schema.sql), and click **Run**. It should say *Success. No rows returned*.

### 2. Add Mom and yourself as users

1. **Authentication → Users → Add user → Create new user.** Enter Mom's email and a password she'll remember, tick **Auto Confirm User**, and click **Create user**. Do the same for yourself.
2. Turn off sign-ups so nobody else can make an account: **Authentication → Sign In / Providers**, switch off **Allow new users to sign up**, and click **Save**.
3. Put both emails on the allowed list. In **SQL Editor → New query**, run (with your real emails):

   ```sql
   insert into public.allowed_users (email) values
     ('mom@example.com'),
     ('you@example.com');
   ```

   Having an account isn't enough by itself: only emails on this list can see or change recipes. To let someone in later, add a user *and* their email here. (For the rest of the family there's guest mode instead; see below.)

### 3. Copy her recipes in

1. On your computer, in the folder that has `recipe-app` and `Recepies 2.0.xlsx`, run:

   ```bash
   python3 recipe-app/dev/make-import.py
   ```

   It should say *Wrote 433 recipes*. It makes `recipe-app/dev/import.sql`. **This file has her recipes in it, so never commit or share it** (it's in `.gitignore`).
2. Open `dev/import.sql`, copy all of it, paste it into **SQL Editor → New query** in Supabase, and click **Run**. The result should show `recipes_imported: 433`.

Every row goes in exactly as she typed it, including "To try", "Main course " and blank statuses. The app reads those the way they were meant. If you run the import a second time it stops with *already has recipes in it* and changes nothing.

### 4. Point the app at the project

1. In Supabase, click **Connect** at the top of the project (or go to **Project Settings → API Keys**). Copy the **Project URL** and the **publishable** key (starts with `sb_publishable_`; the older **anon public** key works too).
2. Put them in [app/config.js](app/config.js) in place of `YOUR-PROJECT-ID` and `YOUR-ANON-KEY`.
3. Commit and push.

That key is meant to be public, so it's fine in a public repo: what keeps her recipes private is the Row Level Security in `schema.sql`, which only lets signed-in people on the allowed list in. **Never** put the `service_role` / secret key anywhere in this repo.

### 5. Put it on Vercel

1. Go to https://vercel.com and sign up with your GitHub account (the free **Hobby** plan).
2. Click **Add New → Project**, find the `cookery` repo, and click **Import**.
3. Set **Framework Preset** to **Other**. Leave **Root Directory** as it is, and leave the build settings alone (there's no build command; `vercel.json` already tells Vercel to serve the `app` folder).
4. Click **Deploy**. After a minute you get a link like `https://cookery-something.vercel.app`. You can pick a nicer name under **Settings → Domains**.
5. Open the link with `#signin` on the end (`https://cookery-something.vercel.app/#signin`) on your computer and sign in with your own account to check that her recipes show up. The plain address only shows the family welcome (name and family code); the email sign-in is at `#signin`, and nothing on the plain address points to it.

### 6. Keep the database awake

Free Supabase projects pause after about a week without use. A GitHub Action ([.github/workflows/keepalive.yml](.github/workflows/keepalive.yml)) pokes it every 3 days. It needs two secrets:

1. On GitHub, open the `cookery` repo, then **Settings → Secrets and variables → Actions → New repository secret**.
2. Add `SUPABASE_URL` (the Project URL) and `SUPABASE_ANON_KEY` (the same key as in `config.js`).
3. Go to the **Actions** tab, pick **Keep Supabase awake**, and click **Run workflow** to check that it goes green.

GitHub switches off scheduled Actions in a repo that's had no commits for 60 days, and emails you first. If that happens, click **Enable workflow** on the Actions tab (or push any small change).

### 7. Turn off the old setup

- **GitHub Pages**: the old site is still online. In the repo, go to **Settings → Pages** and unpublish it (set **Source** to *None*, or use **Unpublish site**).
- **Apps Script**: in the old Google Sheet, go to **Extensions → Apps Script → Deploy → Manage deployments → Archive**, so nothing can write to the sheet. Keep the sheet as a backup if you like; the app no longer uses it.

### 8. Mom's phone

1. Remove the old Recipes app: press and hold its icon, then **Uninstall** (or **Remove**). It's the old GitHub Pages version and won't get her new recipes.
2. In Chrome, open the Vercel link with `#signin` on the end (e.g. `https://cookery-five.vercel.app/#signin`) and sign in with her email and password. She stays signed in from then on, and the app opens straight in from the plain address. (The same line is at the bottom of Visitors, for the next new phone.)
3. Open the **⋮** menu, then **Add to Home screen** (or **Install app**).
4. Open YouTube, tap **Share** on any video, and **Recipes** should be in the list. It can take a minute to appear after installing.

### Adding Last made, the shopping list and photos (once, on an existing project)

If the project was set up before these features, open **SQL Editor → New query**, paste in everything from [supabase/migrations/002_last_made_shopping_photos.sql](supabase/migrations/002_last_made_shopping_photos.sql), and click **Run** *before* pushing the app version that uses them (that version asks for the new columns and won't load recipes without them). It's safe to run twice. A brand-new project doesn't need it: `schema.sql` already has everything.

### Adding Quick & easy / Gourmet (once, on an existing project)

Run [supabase/migrations/003_effort.sql](supabase/migrations/003_effort.sql) in **SQL Editor** the same way, *before* pushing the app version that uses it (it asks for the `effort` column). Then fill in her labels with `dev/effort.sql` (made by `python3 dev/make-effort.py`, never committed).

### Adding the meal plan (once, on an existing project)

Run [supabase/migrations/004_meal_plan.sql](supabase/migrations/004_meal_plan.sql) in **SQL Editor** the same way, *before* pushing the app version that has the **Plan** tab (it reads and writes the new `meal_plan` table). It's safe to run twice.

### Adding guest mode and "Shows in" (once, on an existing project)

[supabase/migrations/005_guests.sql](supabase/migrations/005_guests.sql) adds guest mode and [006_meals.sql](supabase/migrations/006_meals.sql) adds the per-dish meals. Both must be run *before* pushing the app version that uses them. Guest mode also needs **Allow anonymous sign-ins** switched on in the dashboard. Follow [dev/GUEST-ROLLOUT.md](dev/GUEST-ROLLOUT.md) step by step: backup, migrations, the rolled-back rules check ([dev/guest-rls-test.sql](dev/guest-rls-test.sql)), dashboard switches, deploy, checks, the first family code, and how to undo it all.

[supabase/migrations/009_family_code.sql](supabase/migrations/009_family_code.sql) lets you choose the family code (`set_family_code()`) and makes `join_family()` ignore capitals and extra spaces. Run it *before* deploying the version with the **Family code** box on Visitors (sw `recipes-v28`); see step 2b in [dev/GUEST-ROLLOUT.md](dev/GUEST-ROLLOUT.md).

How guest mode is kept safe:
- A guest is a Supabase **anonymous user** with a row in `public.guests`. They only get that row from `join_family(code, name)` with the current code. An anonymous user without one sees nothing.
- The code lives in `private.family_code`, a schema the API doesn't expose, so guests can never read it. Only Mom and you can (`get_family_code()`, `new_family_code()`, `set_family_code()`); 10 wrong codes in 15 minutes and that session stops being checked.
- A short code you choose is easier to guess than a random one. Each try needs a new anonymous sign-in (Supabase allows about 30 per hour per IP address), so keep it 6 characters or more (the database insists), pick something family know and strangers wouldn't, and change it if it ever goes somewhere it shouldn't. People already in stay in.
- Mom's rules are unchanged. Guests get rules of their own: read recipes with `owner is null` (Mom's) or their own, and add, change or delete only their own (`owner` = them). Shopping list and plan rows likewise, only where `guest_id` = them. Dish photos: look, never add, replace or remove.
- Mom's recipes still can't be deleted through the app: a trigger refuses to delete any recipe with no owner.
- The app asks only for `owner is null` / `guest_id is null` when Mom or you are signed in, so guests' rows never show up in her lists.

## Making changes later

Edit the files, then commit and push to `main`. Vercel builds nothing; it just publishes the new files, usually within a minute. Her phone picks up the new version the next time she opens the app with internet (the service worker always checks for new files first).

Every push to another branch, or a pull request, gets its own preview link on Vercel, so you can try a change before it reaches her. Previews use the same database, so a recipe you edit there is edited for her too.

If you change the database, do it in **SQL Editor** with a new file in `supabase/migrations/`, and also update `supabase/schema.sql` so it stays a true record.

## Try it on your computer

```bash
node recipe-app/dev/server.js --fake
```

Then open http://localhost:8787/#signin to sign in, or http://localhost:8787 for guest mode with the pretend family code `family-test` (the old-style link http://localhost:8787/#join=family-test works too). `--fake` swaps Supabase for a pretend database in the browser ([dev/fake-supabase.js](dev/fake-supabase.js)) with a few made-up recipes (some already "made" recently), an empty shopping list and meal plan, and pretend photo storage, so you can try everything without touching hers. The test sign-ins are at the top of that file. In the browser console, `fakeDb.reset()` starts over and `fakeDb.offline = true` pretends the internet is down.

`node recipe-app/dev/server.js --fake --mine` fills the pretend database with Mom's real recipes instead, built in memory from her gitignored files in `dev/` (only on a computer that has them), so the tiles and lists look the way she'll see them. Only this computer can open it.

Without `--fake` it uses the real project from `app/config.js`, so anything you change is changed for Mom too. YouTube titles work locally either way: the server runs the same `api/meta.js` that Vercel does.

## Things worth knowing

- **Her values are kept as typed.** The app reads "To try", "Tried -okay", "Main course " and blank cells forgivingly but only rewrites a field when she changes it in the app. New recipes get the tidy values ("To Try", "Main Course").
- **Duplicates**: each recipe stores a `link_key` (the video or post id) so the same video is spotted however the link looks. `linkKey` is in `app/links.js` and copied to Python in `dev/make-import.py`; change both together.
- **Order**: imported recipes keep her sheet order (id 1 is the first row); new ones get higher ids and show first.
- **Instagram and Facebook** don't let apps read titles or thumbnails, so for those she types the name, and the recipe page has no picture until she adds her own photo.
- **Photos** are private: the app asks Supabase for links that work for a few hours. Changing a photo removes the old file. They count towards the free plan's 1 GB of storage; at a few hundred KB each that's thousands of photos.
- **Backups**: the free plan doesn't keep backups you can download. Every so often, open **Table Editor → recipes** in Supabase and use **Export → CSV**. Keep that file private.
- **Sign out** is at the bottom of the Today tab, in case you ever sign in on someone else's phone.
- **Guests and notes**: guests never see Mom's notes in the app, which never asks for them. But the database rules work per row, not per column, so someone technically minded with the family code could still ask the database directly for the notes on her recipes (and her rating, last-made date and so on). Don't put anything in a note that the family shouldn't read.
- **Removing a guest** hides everything from them at once. Their own rows stay, hidden, in case they come back on the same phone with a current link. Deleting their anonymous user (Authentication → Users) clears it all. Anonymous users from failed joins and *Leave guest mode* pile up slowly; delete old ones now and then.
