# My Recipes

A small phone app for Mom's recipe collection. Her recipes live in a **Supabase** database and the app is hosted on **Vercel**. She only ever uses the app; there's no spreadsheet to keep in step any more.

What it does:
- **Share to save**: in YouTube, Instagram or Facebook, she taps Share and then Recipes. The link and source are filled in, and for YouTube the thumbnail and an English name are too.
- **Already saved warning**: it spots the same video even when the link looks different.
- **Browse**: picture cards with search (names and notes) and filters for status and category.
- **What should I cook today?**: picks one recipe for the time of day, either something new or an old favourite. After she cooks it, the app asks how it was and whether there's anything to note.
- **Yo Mom**: each time she opens the app, nine of her Loved recipes are dealt out and one is picked for today.
- **Remove**: sets the status to *Not Interested*. Nothing is ever deleted. Recipes she named "ignore" are hidden as well.

```
app/          the phone app (plain files; this is what Vercel serves)
api/meta.js   tiny Vercel function that looks up YouTube titles
supabase/     the database setup (schema.sql)
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

   Having an account isn't enough by itself: only emails on this list can see or change recipes. To let someone in later, add a user *and* their email here.

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
5. Open the link on your computer and sign in with your own account to check that her recipes show up.

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
2. In Chrome, open the Vercel link and sign in with her email and password. She stays signed in from then on.
3. Open the **⋮** menu, then **Add to Home screen** (or **Install app**).
4. Open YouTube, tap **Share** on any video, and **Recipes** should be in the list. It can take a minute to appear after installing.

## Making changes later

Edit the files, then commit and push to `main`. Vercel builds nothing; it just publishes the new files, usually within a minute. Her phone picks up the new version the next time she opens the app with internet (the service worker always checks for new files first).

Every push to another branch, or a pull request, gets its own preview link on Vercel, so you can try a change before it reaches her. Previews use the same database, so a recipe you edit there is edited for her too.

If you change the database (for example to use the `protein` or `ingredients` columns), do it in **SQL Editor** and also update `supabase/schema.sql` so it stays a true record.

## Try it on your computer

```bash
node recipe-app/dev/server.js --fake
```

Then open http://localhost:8787. `--fake` swaps Supabase for a pretend database in the browser ([dev/fake-supabase.js](dev/fake-supabase.js)) with a few made-up recipes, so you can try everything without touching hers. The test sign-ins are at the top of that file. In the browser console, `fakeDb.reset()` starts over and `fakeDb.offline = true` pretends the internet is down.

Without `--fake` it uses the real project from `app/config.js`, so anything you change is changed for Mom too. YouTube titles work locally either way: the server runs the same `api/meta.js` that Vercel does.

## Things worth knowing

- **Her values are kept as typed.** The app reads "To try", "Tried -okay", "Main course " and blank cells forgivingly but only rewrites a field when she changes it in the app. New recipes get the tidy values ("To Try", "Main Course").
- **Duplicates**: each recipe stores a `link_key` (the video or post id) so the same video is spotted however the link looks. `linkKey` is in `app/links.js` and copied to Python in `dev/make-import.py`; change both together.
- **Order**: imported recipes keep her sheet order (id 1 is the first row); new ones get higher ids and show first.
- **Instagram and Facebook** don't let apps read titles or thumbnails, so for those she types the name and the card shows a coloured tile.
- **Backups**: the free plan doesn't keep backups you can download. Every so often, open **Table Editor → recipes** in Supabase and use **Export → CSV**. Keep that file private.
- **Sign out** is at the bottom of the Recipes tab, in case you ever sign in on someone else's phone.
