# Backlog

Mom's requests for the app, one line each, worked on one at a time from the top.

- **CR** (change request): change something the app already does.
- **ER** (enhancement request): add something new.
- **Status:** Waiting, In progress, Parked (not until something else happens) or Done.

## Up next

| # | Type | Request | Why | Priority | Status |
|---|------|---------|-----|----------|--------|
| 1 | CR | Keep Mom's notes private from guests in the database itself, not just hidden on screen | Guests can't see her notes in the app, but could read them through the database API. Needs fixing before more people come in | High | Done, live 14 Oct 2026 (migration 011) |
| 2 | ER | Cooked it: comments and photos. **Recipe page:** a comments section under the recipe where anyone (Mom, Sharon, guests) can post a comment and a photo after cooking it, any time later. Each post shows the person's name and the date, and Mom's posts are marked "Mom" (this is her review). **Photo wall:** a new tab with everyone's cooking photos, newest first, dish name under each. Tapping a photo enlarges it, with the name, date, comment and a "Go to recipe" button. Each person can delete their own posts, and Sharon can delete anyone's. Photos are made smaller on the phone (which also strips their location). Replaces "I made this today": a post by Mom marks the dish as made, and the Cooked tab's **Mine** is her list of what she's cooked | Family share what they cooked, and others can find the recipes people have actually tried | High | Done, live 14 Oct 2026 (migration 012) |
| 3a | ER | **Cooking method on every recipe**, so nobody has to watch the whole video. A numbered "Method" under the ingredients, shown to guests too, editable by Mom in Edit (her version always wins). One-off fill: write short steps in plain words from each YouTube video's description and captions (249 recipes; Instagram 169 and Facebook 94 mostly can't be read automatically, Mom can type those). Each filled method says "Steps written from the video. Check quantities with the video if unsure." Start with a 5-recipe sample to judge quality. Later, optionally: steps for new recipes automatically (needs an AI API key, well under ₹1 a recipe) | Saves watching long videos while cooking | High | Waiting (after the security check) |
| 3b | ER | **Like notices in the app** (no phone notifications): a small dot on the round initial at the top of Today and Cooked when someone liked your post since you last looked; the You page lists "New likes" (who liked which dish, newest first, tap to open the post); opening the You page marks them seen. Remembered per person in the database, so it works across phones. Phone notifications can come later if people want them | People know their post was seen, and come back to the app | Medium | Waiting (plan agreed: in-app only) |
| 3 | ER | Trusted pilot: Mom shares the family code with 10 to 20 people she trusts, free, for about a month. Ask them for feedback and whether they'd pay | Shows whether people keep coming back (Visitors shows first and last visit) before anything paid is built. No code needed | High | Waiting (after 1 and 2) |
| 2b | CR | Security check fixes (report in the private dev/security/REPORT.md): the join lockout, the unused admin email, household-only access for Mom's account, Remove with posts and "Change code", recipe ids, post limits and reserved names, storage limits, backup, safer links, headers | Before sharing with 5-7 more people | High | Done, live 15 Oct 2026 (migration 014). Still for Sharon: after the aunt switches, change Mom's password and sign out other devices; turn on Supabase usage alerts; weekly backup |
| 4 | CR | Bring README.md up to date (no shopping list, the pastel look, the simpler Recipes tab, only Sharon sees visitors) | It still describes some older versions | Low | Waiting |
| 5 | CR | Update `dev/guest-rls-test.sql` for migrations 007 to 010 | The guest safety test is out of date | Medium | Waiting |
| 6 | ER | A "not a robot" check (Cloudflare Turnstile) on guest sign-in | Worth having before the family code goes beyond family | Medium | Waiting |

## Parked

| # | Type | Request | Waiting on | Status |
|---|------|---------|------------|--------|
| 7 | ER | Paid meal plans: priced per plan (e.g. ₹250 to ₹400 for 5 days) or per day or week, with weekly and monthly offers. Guests pick dishes and pay | The pilot (3) showing people come back. Then needs: guests' own logins (phone OTP), Razorpay with KYC, terms, refund and privacy policies, Vercel Pro (the free plan isn't for commercial use), and a check of any employer rules on side income | Parked |
| 8 | ER | Guests can plan up to 3 days free, then subscribe | The paid version (7). The 3-day limit itself is small | Parked |
| 9 | ER | Connect GitHub to Vercel so a push deploys | Not needed while deploys are done by hand on purpose | Parked |

## Done

| Type | Request | Done |
|------|---------|------|
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
