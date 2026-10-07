# My Recipes

A small phone app for Mom's recipe collection. Her **Google Sheet stays the only copy of the data**: the app reads it, adds rows, and updates the Status, Category, Name and Notes columns. She can keep editing the sheet directly at the same time.

What it does:
- **Share to save**: in YouTube, Instagram or Facebook, she taps Share and then Recipes. The link and source are filled in, and for YouTube the thumbnail and an English name are too.
- **Already saved warning**: it spots the same video even when the link looks different.
- **Browse**: picture cards with search (names and notes) and filters for status and category.
- **What should I cook today?**: picks one recipe for the time of day, either something new or an old favourite. After she cooks it, the app asks how it was and whether there's anything to note.
- **Remove**: sets the status to *Not Interested*. Nothing is ever deleted from the sheet. Rows she named "ignore" are hidden as well.

```
app/            the phone app (static files: this is what gets hosted)
apps-script/    the script that goes inside her Google Sheet
dev/            local test server and the test copy of her data (don't host this)
```

## Try it on your computer

```bash
node recipe-app/dev/server.js --reset
```

Then open the link it prints. The script runs against `dev/test-sheet.json`, a copy of the rows from `Recepies 2.0.xlsx`. `--reset` starts again from a fresh copy. If the spreadsheet changes, run `python3 recipe-app/dev/make-fixture.py` to refresh the copy (or pass a different `.xlsx` path).

## Put it on Mom's phone

**The source of truth is `Recepies 2.0.xlsx`.** The app can only talk to a Google Sheet, so that file needs to be in Google Sheets first:

1. Upload `Recepies 2.0.xlsx` to Google Drive.
2. Open it, then go to **File → Save as Google Sheets**. Apps Script can't attach to an `.xlsx` file, only to a real Google Sheet.
3. Use that new Google Sheet for every step below. From then on it's the live copy. **File → Download → Microsoft Excel** gives you an up-to-date `.xlsx` whenever you want one.

If the script was already added to the old sheet, retire it there: in that sheet's Apps Script, go to **Deploy → Manage deployments → Archive**. That way nothing can write to the old sheet.

### 1. Add the script to the sheet

1. Open the sheet, then go to **Extensions → Apps Script**.
2. Replace everything in `Code.gs` with [apps-script/Code.gs](apps-script/Code.gs).
3. Go to **Project Settings** (gear icon), tick **Show "appsscript.json"**, then go back to the editor and replace that file with [apps-script/appsscript.json](apps-script/appsscript.json).
4. Pick `setup` in the function dropdown and click **Run**. Approve the permissions, which only cover *this* spreadsheet plus fetching YouTube titles. This adds the **Notes** column and prints an **app key** in the log. Copy the key.
5. Click **Deploy → New deployment**, choose type **Web app**, set *Execute as* to **Me** and *Who has access* to **Anyone**, then click Deploy. Copy the **Web app URL** (it ends in `/exec`).

Whoever deploys the script needs edit access to the sheet, because the script runs as that person.

To change the script later, use **Deploy → Manage deployments → ✏️ → Version: New version**. The URL stays the same.

### 2. Host the app

The `app/` folder is plain files, so any HTTPS static host works. Two simple options:
- **Netlify Drop**: drag the `app` folder onto https://app.netlify.com/drop.
- **GitHub Pages**: push `app/` to a repo and turn on Pages.

### 3. Connect her phone

Make the setup link by filling in the two values from step 1:

```bash
node -e "console.log(process.argv[1] + '#setup=' + encodeURIComponent(process.argv[2]) + '&key=' + process.argv[3])" "https://YOUR-SITE/" "https://script.google.com/macros/s/XXXX/exec" "YOUR_KEY"
```

On her phone, in Chrome:
1. Open the setup link. It shows "Connected to your recipe sheet".
2. Open the ⋮ menu, then **Add to Home screen** (or **Install app**).
3. Open YouTube, tap **Share** on any video, and **Recipes** should be in the list. It can take a minute to appear after installing.

The key only lives on her phone, in the `#` part of the link, which is never sent to the hosting site. Anyone with both the URL and the key could edit the sheet, so don't post the setup link anywhere.

## Things worth knowing

- The script finds columns **by their header name**, so the columns can be reordered, but the headers *Recipe Name*, *Category*, *Status*, *Recipe Link*, *Source* and *Notes* need to stay as they are.
- Her hand-typed values ("To try", "Main course ", blank statuses) are read as they're meant to be but are **never rewritten**. A cell only changes when she edits that recipe in the app.
- A new category she adds in the app is remembered on her phone and shows up in the sheet as soon as a recipe uses it.
- Instagram and Facebook don't allow apps to read titles or thumbnails, so for those she types the name and the card shows a coloured tile.
- `sourceFor`, `youTubeId` and `linkKey` exist in both `apps-script/Code.gs` and `app/links.js`. If you change one copy, change the other.
