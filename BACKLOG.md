# Backlog

Mom's requests for the app, one line each, worked on one at a time from the top.

- **CR** (change request): change something the app already does.
- **ER** (enhancement request): add something new.
- **Status:** Waiting, In progress, Parked (not until something else happens) or Done.

## Up next

| # | Type | Request | Why | Priority | Status |
|---|------|---------|-----|----------|--------|
| 3c | ER | **Veg mode**: a "Veg" switch at the top of Today (next to Quick & easy / Gourmet) and in the Recipes shortcut row. When on, non-veg dishes are hidden everywhere: Today's suggestions and lists, Recipes, the Plan picker and the first page. Non-veg = meat, chicken, fish, prawns and other seafood, **and egg**. Each person (Mom, Sharon, every guest) has their own switch, remembered until turned off. Dishes are labelled automatically from their name and ingredients; Mom can correct a dish's label in Edit (her label wins) | Vegetarian relatives and fasting days | High | Done, live 29 Oct 2026 (migration 018). The Recipes switch sits beside "What do you have?" so the shortcut row still fits. About 18 cakes may need Mom to mark egg |
| 3 | ER | Trusted pilot: Mom shares the family code with 10 to 20 people she trusts, free, for about a month. Ask them for feedback and whether they'd pay | Shows whether people keep coming back (Visitors shows first and last visit) before anything paid is built. No code needed | High | Ready whenever Mom is (nothing to build) |
| 4 | CR | Bring README.md up to date (no shopping list, the pastel look, the simpler Recipes tab, only Sharon sees visitors) | It still describes some older versions | Low | Waiting |
| 5 | CR | Update `dev/guest-rls-test.sql` for migrations 007 to 017 | The guest safety test is out of date | Medium | Waiting |
| 6 | ER | A "not a robot" check (Cloudflare Turnstile) on guest sign-in | Worth having before the family code goes beyond family | Medium | Waiting |
| 10 | CR | Change Mom's password and sign out her other devices, once the aunt has tapped "Not Mom?" on her phone (Supabase > Authentication > Users) | Then Mom's account is only on Mom's phone (security check #3) | High | Waiting (for Sharon, after the aunt switches) |
| 11 | CR | Turn on Supabase usage alerts (Organization > Usage) | Warns before the free plan's limits are reached | Medium | Waiting (for Sharon, dashboard) |
| 12 | CR | Turn off the old GitHub Pages copy of the first version (repo Settings > Pages) | Relatives could find or install the wrong app | Low | Waiting |
| 13 | CR | Weekly backups of all tables and photos into the private dev/backup/ (as done before each change), with a copy off the laptop | The free plan has no restorable backups and none of photos | Medium | Waiting |
| 14 | ER | More cooking steps: read the captions of the ~135 YouTube videos that explain the method only by speaking (needs the yt-dlp tool on the laptop; often auto-made Malayalam, translated), with a stronger "check with the video" note | 63 of 255 YouTube recipes have steps so far | Medium | Mostly done 2 Nov 2026: 64 more recipes from their transcripts (127 of 255 YouTube recipes have steps). Left: 72 videos with no captions, 23 that won't open, 15 with no usable speech; Instagram and Facebook can't be read |
| 15 | CR | Security report leftovers: a deleted post can leave its photo behind (and posts moved by "Not Mom?" keep photos in Mom's folder); likes stop showing correctly past about 1,000 | Small tidy-ups | Low | Waiting |

## Parked

| # | Type | Request | Waiting on | Status |
|---|------|---------|------------|--------|
| 7 | ER | Paid meal plans: priced per plan (e.g. ₹250 to ₹400 for 5 days) or per day or week, with weekly and monthly offers. Guests pick dishes and pay | The pilot (3) showing people come back. Then needs: guests' own logins (phone OTP), Razorpay with KYC, terms, refund and privacy policies, Vercel Pro (the free plan isn't for commercial use), and a check of any employer rules on side income | Parked |
| 8 | ER | Guests can plan up to 3 days free, then subscribe | The paid version (7). The 3-day limit itself is small | Parked |
| 9 | ER | Connect GitHub to Vercel so a push deploys | Not needed while deploys are done by hand on purpose | Parked |

## Done

| Type | Request | Done |
|------|---------|------|
| CR | Mom's notes private from guests in the database itself (family_recipes, migration 011) | 14 Oct 2026 |
| ER | Cooked it: "I cooked this" posts with comments and photos under each recipe, the Cooked photo wall, Mine, delete with Undo (migration 012) | 14 Oct 2026 |
| ER | Cooking method: numbered steps under the ingredients, editable in Edit; 63 of 255 YouTube recipes filled from their descriptions (migration 017) | 21 Oct 2026 |
| ER | Like notices: a dot on the round initial and "Likes on your posts" on the You page (migration 016) | 20 Oct 2026 |
| CR | Security check fixes: join lockout, unused admin email, household-only access for Mom's account, Remove with posts, recipe ids, post limits and reserved names, storage limits, backup, safer links, headers (migrations 014, 015) | 15 Oct 2026 |
| ER | You page (round initial: who's signed in, People, family code, sign out), likes, "Posting as", guests can rename themselves, one-tap "Not Mom?" switch to a phone's own guest (migration 013) | 15 Oct 2026 |
| CR | Tapping a dish on the first page opens the recipe, not a Google search | Oct 2026 |
| CR | First page slower, with a new pattern (the coloured checkerboard) | Oct 2026 |
| ER | Plan meals for any day, with a back button | Oct 2026 |
| ER | Pick any date to plan for | Oct 2026 |
| ER | Guest mode for family without emails, and a list of who comes in | Oct 2026 |
| ER | Choose which meals a dish shows in (e.g. a curry in Lunch only) | Oct 2026 |
| CR | Remove the shopping list | Oct 2026 |
| ER | Add the same dish more than once to a plan | Oct 2026 |
| CR | Recipe page read-only, with an Edit button | Oct 2026 |
| CR | New look: soft pastel colours in place of the green and yellow | Oct 2026 |
| ER | Naadan and One pot sections, and 30 new recipes for them | Oct 2026 |
| CR | Search that makes sense ("prawns roast" no longer suggests chicken), fewer filters and buttons | Oct 2026 |
| CR | One address for guests with a family code, and Mom's sign-in kept out of sight | Oct 2026 |
| CR | Only Sharon sees the visitors list. Mom keeps the family code | Oct 2026 |
| CR | Refreshing stays on the same page instead of replaying the first page | Oct 2026 |
