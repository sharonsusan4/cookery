# Design: "Sorbet" (colours) on the "Banana leaf" layout

**Colours changed in October 2026.** Mom didn't like the green and yellow, and
chose **Sorbet** from a side-by-side board: a light warm page (`#fdf8f4`),
dark text (`#2e2622`), white raised cards, coral for the accent and primary
buttons (`#b4462f`, white text on it), and each dish card on its own soft
pastel by dish type (`--orange-bg` … `--gray-bg` in `app/styles.css`: peach,
rose, mint, butter, lilac, sky…). First page XO squares: peach `#fce3d6` and
lilac `#e3e0f4`. `theme-color` and the manifest colours are `#fdf8f4`, and
`color-scheme` is light. All text pairs pass WCAG AA (coral ≥4.7:1 on every
surface, outlines ≥3:1). The variable *names* below (`--leaf`, `--cream`,
`--brass`) are kept from the green theme; read them as page, page text and
accent. Everything else in this file (layout, type, spacing, motion, do's and
don'ts) still applies; the hex values in the palette section below are the
old green theme's.

---

## Original notes ("Banana leaf")

The look of Mom's recipe app. A deep banana-leaf green page, cream text, and
brass for the few small things that matter. The dishes sit on the leaf as
cream cards, and today's idea is a round cream plate. It is built for one
reader first: Mom, a Kerala home cook with older eyes, on an Android phone.

Everything lives in `app/styles.css` (tokens at the top, under `:root`). Keep
this file and that one in step. There is **one theme**: the phone's light or
dark setting doesn't change it (the green is already dark). `theme-color` in
`index.html` and both colours in `manifest.webmanifest` are `#1c3520`.

## What Mom and Sharon have said

**Rejected (don't bring these back):**
- Generic rounded pills (fully rounded buttons, tabs or chips). Corners here
  are 8–20px, never a full pill. Only true circles are round: the plate, the
  "−" button, the meal chevron, dots.
- "Funky" stickers and decorations ("makes me feel dyslexic").
- Anything tilted or rotated while at rest.
- Busy, crowded layouts.
- Fast flipping or bouncy animation ("too fast for my old eyes").
- Photos in grids: they never match. Tiles use line icons; photos only
  appear on a dish's own page.
- The earlier "cream, refined" redesign: correct but boring.

**Liked (keep):**
- Calm and minimal, big words.
- Thin line icons on tiles, coloured by the kind of dish.
- The XO first page, its squares played in turn, and its timing
  (`welcome.js`, `T`). Only its colours changed.
- The Quick & easy / Gourmet choice as plain words.
- The "Banana leaf" concept (`dev/concepts/index.html#leaf`).

## Palette

| Token | Hex | Use |
|---|---|---|
| `--leaf` | `#1c3520` | the page |
| `--leaf-deep` | `#142817` | bottom bar, fields, wells |
| `--leaf-raised` | `#22402a` | green cards: plan meals, choosers, ingredients, visitors |
| `--leaf-glow` | `#28492d` | the soft light at the top of each screen |
| `--cream` | `#f4ebd6` | text on the leaf; dish cards; messages |
| `--cream-2` | `#d2c8af` | secondary text |
| `--cream-3` | `#bcb69c` | quiet text, tab labels, unchosen words |
| `--plate` / `--plate-ring` | `#fbf4e2` / `#eadfc2` | the "Try this" plate |
| `--hairline` | cream at 13% | decorative rules only (never the only edge of a control) |
| `--line-strong` | `#8a9a7f` | outlines of fields, chips, secondary buttons |
| `--brass` | `#d4a84b` | small caps labels, the chosen thing, primary buttons, links |
| `--on-brass` | `#142817` | text on brass |
| `--ink` | `#1f3b22` | text on cream |
| `--ink-2` | `#55624f` | quiet text on cream (status on tiles) |
| `--ink-link` | `#7a5410` | a link on cream ("Undo" in a message) |
| `--danger` | `#f2a08f` | Remove |
| `--warning` | `#e8c374` | "You already saved this" |
| `--xo-x` / `--xo-o` | `#f4ebd6` / `#ddbb75` | first page: cream X squares, sand O squares |

The page itself is `--leaf` with two background layers on `body` that scroll
with the page: a radial `--leaf-glow` light at the top, and faint diagonal
leaf veins (`repeating-linear-gradient(118deg, …)`, 1px of white at 3% every
47px). The first page uses the same two layers.

**Contrast (WCAG AA, checked by script):** cream 11.2:1 on leaf, 9.3:1 on
raised; cream-2 8.0 / 6.6; cream-3 6.5 / 5.5 (4.9 on the glow); brass 6.0 on
leaf, 5.2 on raised, 4.6 even at the brightest point of the glow; on-brass
7.1:1; ink 10.4:1 on cream; ink-2 5.5:1; ink-link 5.7:1. Line-strong is
4.4:1 on leaf and 3.7:1 on raised (controls need 3:1). **Brass is never used
as text on cream (1.9:1).**

### Dish icon colours (`tileTint`)

`tileTint(r)` in `app.js` still names a tint per dish; each `.tint-*` class
now sets only `--tile-fg`, the **icon colour** on a cream card. Every one is at
least 4.6:1 on cream.

| Tint | Hex | Meaning |
|---|---|---|
| orange | `#a3441f` | meat: terracotta |
| red | `#8e2424` | fish, pickles: deep red |
| green | `#3d6b3f` | rice, vegetables: leaf green |
| olive | `#5a6118` | vegetables: curry leaf |
| yellow | `#8a6210` | curries, eggs, bread: turmeric |
| pink | `#7e3762` | sweets: plum |
| plum | `#6b3f7a` | cheese, snacks: kokum |
| teal | `#1f6660` | drinks, soups: teal |
| brown | `#77502d` | baking: jaggery |
| blue | `#2f5a80` | dinner (category fallback) |
| gray | `#5c5a4e` | anything else |

On the first page the cards keep their `tint-orange` (X) and `tint-green` (O)
classes from `welcome.js`; `.welcome-grid` turns those into cream and sand
squares with deep green icons and names.

## Type

- **Display: Gloock** (Google Fonts, one weight, 400). Big words and names:
  the meal word, the day word, "Yo Mom", screen titles, dish names, section
  titles. `font-synthesis: none` so it is never faked bold.
- **Body: Atkinson Hyperlegible Next** 400–700, made for low vision.
- Small capitals: 13px, weight 600, letter-spacing 0.2em, uppercase, brass.

| Token | Size | Use |
|---|---|---|
| `--fs-xs` | 13px | small caps labels, tab labels |
| `--fs-sm` | 15.5px | meta lines, hints (tile names are 14.5px/600) |
| `--fs-base` | 18px | body; buttons and fields are 17px |
| `--fs-md` | 20px | lead text ("Let's cook…", join text) |
| `--fs-lg` | 24px | section headings (Gloock) |
| `--fs-xl` | 34px | a dish's title on its page (Gloock) |
| `--fs-2xl` | 44px | screen titles: Recipes, Add a recipe (Gloock) |
| `--fs-3xl` | 60px | the meal word, the day word (Gloock); Yo Mom is 56–80px |

## Tokens

- Space: `--s1`…`--s7` = 4, 8, 12, 16, 24, 32, 48px. Gutter 16px.
- Radii: `--r-sm` 8 (chips, badges), `--r-md` 12 (buttons, fields, plan
  icons), `--r-lg` 16 (dish cards), `--r-xl` 20 (green cards, pictures).
- Shadows: `--shadow-card` (cream cards on the leaf), `--shadow-raised` (green
  cards: a faint top highlight and a soft drop), `--shadow-float` (messages,
  pictures).
- Bar: `--nav-h` 68px plus the safe area. `main` pads its bottom by the bar
  plus 48px, so nothing is ever hidden behind it; `scroll-padding-bottom`
  stops focused fields above it.

## Components

- **Bottom bar** (`.tabs`): `--leaf-deep`, a brass hairline on top, five line
  icons (Tabler, `icons.js`) with labels in `--cream-3`; the current tab is
  brass and bold. A short brass mark glides along the top to the tab she's
  on (`placeTabMark`, 420ms). Hidden on sign-in, join and the first page.
- **Today**: the date in small caps; the meal word in Gloock with a brass
  chevron in a thin brass ring (the phone's own meal list sits over it); the
  **effort switch** as two plain words, the chosen one cream and bold with a
  brass underline. "On your plan" is a raised card with a brass left edge.
- **Try this plate**: a 124–150px cream disc (plate, ring, plate), a 5px brass
  halo and a soft shadow, the dish's thin icon in its tint colour in the
  middle; "TRY THIS" in brass small caps and the name in Gloock beside it;
  the meta line, then **Open recipe** (brass) and **Show another** (outline)
  side by side under it.
- **Dish cards** (`.square`): cream, 16px corners, `--shadow-card`, the icon
  in its tint colour, the name in deep green 14.5px/600, two lines kept.
  Status ("Loved") in `--ink-2` along the bottom. A close match gets a fine
  dashed inner edge, never fading.
- **Recipes tab** (simplified Oct 2026; Mom found it too busy): the title,
  then one search box (a quiet magnifier inside, "Search a dish, or type what
  you have"; no Search button, the keyboard's search key and live results are
  enough). Typing a shortcut word on its own ("naadan", "one pot", "onepot",
  "bachelor", "loved", "to try") shows that shortcut at once and moves it to
  the row when she's done typing. Then one **shortcut row**, All · Naadan ·
  One pot · Loved · To try, plain words sharing the day strip's rules (chosen
  word in ink with a coral underline, one at a time, no counts so all five fit
  at 360px). Then one **"What do you have?"** button (coral outline and words,
  a chevron that turns) opening the "I have" chips and "Make it" bar inline on
  a white card; what she's picked shows under it, open or shut ("With prawns
  · roast", Clear). With nothing searched the dishes sit under quiet Gloock
  headings by kind of meal (Breakfast, Curries and mains, Sides and chutneys,
  Snacks, Sweets and desserts, Breads and baking, Drinks, Other) with a quiet
  count; a search gives one flat list with a one-line heading and the close
  matches as before. No category or status dropdowns, no collection cards.
  On a recipe the collections show as a quiet "Naadan · One pot" line; Edit
  and Add have two toggles in the meal-toggle style.
- **Buttons**: primary is brass with deep green text; secondary is a 1.5px
  `--line-strong` outline with cream text (cream outline on the first page);
  quiet text buttons are brass (or `--cream-2`/`--cream-3` for the quietest).
  All at least 48px tall (52px for full buttons).
- **Fields, selects, search**: `--leaf-deep` wells, `--line-strong` outline,
  cream text, `--cream-3` placeholder; brass outline and a soft brass ring
  when in use; selects have a brass chevron.
- **"I have" chips**: separate outlined labels, 8px corners; chosen ones fill
  brass. **"Make it" bar** and other split choices (`.segmented`): one outlined
  well split by hairlines; the chosen part fills brass.
- **Plan**: "MEAL PLAN", then the day word in Gloock. The **day strip** is
  plain words like the effort switch (brass underline on the chosen day, a
  small brass dot for a day with dishes). Each meal is a raised green card
  with its name in Gloock; dishes are rows with a small cream card holding
  the tinted icon, the name in cream, "×2" in brass, and a quiet ✕. "+ Add
  dish" is brass.
- **Picker**: sticky heading and brass Done (transparent at the top, solid
  once scrolled, via a scroll-linked animation). Cards on the plan get a 3px
  brass ring and a green badge with a brass edge (✓, ×2, ×3); the "−" is a
  30px dark green circle in the top-left corner on a 44px tap area.
- **Recipe page**: Back in brass; the picture with 20px corners, a brass
  hairline edge and a soft shadow; the title in Gloock; "Shows in" with a
  brass Change opening a raised card of meal toggles (chosen = brass with a
  ✓); Open (brass), Add to plan (outline with a brass calendar), and the quiet
  "✓ On today's lunch ×2" note; the "Move to" chooser in a raised card; the
  ingredients as a raised card with hairlines and brass dots.
- **Cooked it** (on a recipe, after the ingredients and notes): "Cooked it" in
  Gloock with a quiet "2 people", an outlined **I cooked this** with a camera
  icon, then each post as a white card: the name bold (Mom's in coral), "3
  days ago" quiet, the words at 17px, the photo 4:3 with 12px corners, and a
  quiet grey Delete on your own. Nothing posted yet: one quiet line.
- **I cooked this** (`#cook/<row>`): the dish in coral small caps, "I cooked
  this" in Gloock, a dashed **Add a photo** (or the photo, with Change photo /
  Take out photo), "How did it turn out?", **Post**, and one quiet line saying
  everyone sees it with your name.
- **Cooked tab**: "Cooked" in Gloock, one line under it, Everyone / Mine as a
  `.segmented` switch, then two square photos a row with 12px corners, the
  dish 15.5px/600 and "Anu · yesterday" quiet under each. In Mine a post with
  no photo shows the dish's own tinted icon tile. No likes, no counts.
- **A photo opened large** (`#photo/<id>`): the one dark screen, near-black
  around the photo (shown whole, not cropped) like a phone's own gallery; a ✕
  top right; the dish in Gloock (white), the name and when, the words, then
  **Go to recipe** (coral) and a quiet Delete on your own. No bar.
- **Messages** (`.toast`): a cream card with deep green text above the bar,
  the action ("Undo", "Change") underlined in `--ink-link`.
- **Welcome ("Welcome!", name + family code) and `#signin`**, notices: no
  bar, the title in Gloock (56px), text in `--cream-2`, a brass primary. The
  plain address shows only the family form; nothing on it points to sign-in.
- **Family code** on Visitors: the code large (30px, bold, spaced) on a raised
  white card, Copy / Share under it, then Change code.
- **Footer links** (Visitors, Sign out, Leave guest mode): `--cream-3`, over a
  hairline.
- **First page (XO)**: same leaf, glow and veins; cream X and sand O squares
  with deep green icons and names; "Yo" brass and the name cream in Gloock;
  the meal word cream in Gloock; Quick & easy brass, Gourmet cream outline.

## Motion

Calm only, `--ease: cubic-bezier(0.22, 0.7, 0.2, 1)`, nothing bounces.
- A new screen fades and rises 8px over 260ms; its first dish cards follow,
  24ms apart (`revealIfNew`). Redraws of the same screen don't animate.
- The bar's mark glides over 420ms. Presses scale to 0.97–0.98 over 160ms.
- Messages fade up 6px over 300ms.
- The first page's timing is fixed (`welcome.js`, `T`); don't change it.
- `prefers-reduced-motion: reduce` turns all of this off (the first page
  jumps to its end).

## Do's and don'ts

**Do**
- Use brass for small, meaningful things: labels, the chosen thing, the main
  button, links. One brass button per area.
- Put dishes on cream; put everything else on the leaf.
- Keep text at least 4.5:1 (3:1 only for 24px+ headings) and outlines of
  controls at least 3:1; re-run the contrast check after any colour change.
- Keep tap targets at least 44–48px, 16px gutters, no sideways page scroll
  at 360–430px, and nothing behind the bar.
- Use Gloock only for big words and names, at weight 400.

**Don't**
- Don't use pills, stickers, tilted things, photo grids, or bouncy or fast
  motion (see Mom's list above).
- Don't fade text with opacity to make it quiet; use `--cream-2`/`--cream-3`.
- Don't put brass text on cream, or cream text on brass.
- Don't add a light theme or follow the phone's dark mode.
- Don't crowd: one idea, then the dishes.
