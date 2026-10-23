# Grocery Planner

A local-first PWA for weekly meal planning and grocery shopping, built to live on GitHub Pages and
be installed from Safari on an iPhone.

- **No build step.** Plain HTML, CSS, and ES modules. Node is only used for the dev server and icon
  generation.
- **No backend, no accounts.** All data stays in the browser (IndexedDB). Moving data between
  phones is an explicit JSON export/import through a shared Google Drive folder. **Search Google
  Drive** opens a prefilled Drive search in a new tab, but the app never connects to your Google
  account.
- **Offline by default.** A service worker caches the app shell, so it opens in airplane mode.
- **Free hosting.** GitHub Pages on a custom domain: `https://cheers-studios.com/grocery-planner/`
  (the `williams4027.github.io` URL redirects there).

Status: **All core features are complete** — per-store lists, Google Calendar trip export, seeded
recipes with ordering and duplication, backup and restore, weekly meal planning with `.ics` export,
shopping/list-management polish, quantity merging, cross-list moves, and a Google Drive backup
search shortcut. Multi-device sharing uses a shared Google Drive folder and manual restore; there
is no automatic merge. See [PLAN.md](./PLAN.md) for the roadmap and optional backlog.

## Quick start

```sh
npm run dev
# → http://localhost:8000/
```

Then open <http://localhost:8000/>. Service workers need an HTTP origin, so don't open
`index.html` directly.

> Testing on a phone over your LAN IP (`http://192.168.x.x:8000`) will load the page but **not**
> register the service worker, because plain HTTP on a LAN address isn't a secure context. Use the
> deployed Pages URL (HTTPS) for install and offline testing.

No dependencies to install. Node 14+ is enough.

Regenerate icons after changing the design:

```sh
npm run icons
```

## Deploy to GitHub Pages

One-time setup:

> **Visibility:** GitHub Pages from a **private** repository requires GitHub Pro (or Team/
> Enterprise); on GitHub Free the repository must be public. Either way, **the published site is
> publicly reachable** at the Pages URL — only the source is private. That's fine here: no data
> lives in the repo, and app data never leaves the phone.

1. Create a repo named `grocery-planner` on GitHub, public (Free) or private (Pro).
2. Set your git identity if you haven't:
   ```sh
   git config --global user.name "Your Name"
   git config --global user.email "you@example.com"
   ```
3. Wire up the remote and push:
   ```sh
   git remote add origin git@github.com:<your-username>/grocery-planner.git
   git branch -M main
   git push -u origin main
   ```
4. In the repo: **Settings → Pages → Build and deployment**
   - Source: **Deploy from a branch**
   - Branch: **main**, folder: **/ (root)**
   - Save.
5. Wait for the Pages build, then open the live URL — `https://cheers-studios.com/grocery-planner/`
   (or `https://williams4027.github.io/grocery-planner/`, which redirects to it) — on your phone.
   In Safari: **Share → Add to Home Screen**.

## Release checklist

Every deploy:

- [ ] Bump `VERSION` in `js/config.js` (shown in More).
- [ ] Bump `VERSION` in `sw.js` (invalidates the shell cache — **required**, or phones keep old
      files).
- [ ] Add any new shell files to `SHELL_ASSETS` in `sw.js`.
- [ ] `npm run check`
- [ ] Commit, push, and open the Pages URL on a phone.
- [ ] On the phone: verify the version in More and test with airplane mode on.
- [ ] If the update doesn't appear, close and reopen the app; the update toast should reload it.

## Project structure

```
index.html              app shell, meta tags, tab bar
app.css                 design tokens, layout, list styles
manifest.webmanifest    install metadata and icons
sw.js                   offline caching and update behaviour
js/app.js               boot, hash router, tab state, network status
js/config.js            app name, version, schema version, aisles, store presets, storage keys
js/model.js             factories, aisle keyword map, ingredient parsing, normalization
js/dates.js             local date keys, week starts, and day arithmetic
js/backup.js            JSON backup format, parsing, and validation
js/calendar.js          pure Google Calendar trip-detail, URL, and .ics builders
js/store.js             state container, IndexedDB/localStorage persistence, actions
js/seed-recipes.js      recipes seeded from the meal-planning sheet
js/sheet.js             shared bottom-sheet dialog controller
js/ui.js                DOM helper, icons, toast
js/pwa.js               service worker registration and update checks
js/views/               plan.js, list.js, recipes.js, more.js
dev-server.cjs          zero-dependency static server
scripts/make-icons.cjs  generates PNG icons (no image tooling required)
icons/                  generated PWA icons
PLAN.md                 product plan, data model, phase breakdown
```

## What works today

- Keep separate lists for **Kroger, Whole Foods, Costco**, or a custom store; switch with the chips
  above the list. Each list has its own editable aisle order, and the active list is remembered.
- Add items from the docked **Add item** button at the bottom of the list screen; the sheet stays
  open for batch entry. If you have more than one store list, choose **Add to** (Kroger, Costco, …)
  before submitting.
- Add items with labels above every field: name, optional quantity, description (for example,
  “organic” or “green”), and aisle. The aisle starts at **Auto** using the item name; choose any
  aisle to override it. Adding an item that already exists on the target list combines the
  quantities instead of creating a duplicate; simple unit variants like “cup” and “cups” and
  common name plurals like “egg” and “eggs” match. Existing duplicate rows from earlier versions
  are merged once on upgrade. Tap the pencil on any row to edit its name, quantity, description,
  or aisle, or choose another list under **Move to** and save; delete with one tap.
- Items are grouped by aisle (produce, deli, meat and seafood, dairy, pantry, frozen, …) with sticky
  headers. A new custom list starts Produce → Deli → Meat & Seafood → Dairy → Pantry → Frozen,
  then the remaining aisles; store presets start with their own route, and every list can be
  reordered.
- Within each aisle, items are sorted A–Z. Check items off; picked items dim,
  sink to the bottom of their aisle, and both the list counter and each aisle’s progress update.
  Delete an item with one tap and use **Undo** in the toast if needed.
- Tap the **Select** button to choose several rows. Move the selected items to another list (matching
  rows combine quantities), delete them together, or clear the whole list. Delete and clear both
  offer **Undo**; clearing a list asks for confirmation first.
- Rename the active list inline. Open **Manage lists** to reorder that list’s aisles for the route
  through a particular store, duplicate a list (including its checked items), archive a list
  without deleting anything, or restore an archived list later. The last visible list cannot be
  archived.
- **Add trip to Google Calendar** opens a prefilled event with the list in the description. It is a
  link, not an account connection: you pick the title/date/time, then review and save it in Google
  Calendar.
- Browse **recipes seeded from the meal-planning sheet**, search or filter by category, and add all
  of a recipe’s ingredients to the active list or another store list in one tap. Seed ingredients
  use a shared lowercase vocabulary with one canonical choice for alternatives, so ingredients from
  different recipes combine cleanly. Save new recipes or edit a recipe’s title, category, and
  ingredient lines, including quantities; ingredient lines like “2 cups chopped carrots” are split
  into quantity, unit, and item name automatically. In the recipe detail, each ingredient has an
  **Aisle** selector; changes save immediately and carry through when you add the recipe to a list
  or edit its ingredient lines. Use **Move up** and **Move down** to set the order inside a
  category, or **Duplicate** to create a copy directly after the original. Recipe-level serving
  scaling is deferred; the meal plan still scales by planned servings.
- **Plan a week of meals** in a 7-day × 3-slot grid. Move between weeks, jump back to today, set
  servings, copy last week into empty slots, or clear a day. Choosing a recipe adds its ingredients
  to the selected list automatically, scaled to the planned servings. Meals that share an
  ingredient keep one combined row; updating or clearing a meal removes only that meal’s share of
  the quantity. Items you already checked off are kept. **Download .ics** exports the visible week
  as all-day events for Apple or Google Calendar; the file is built locally and never uploaded.
- Everything persists in IndexedDB on the device, survives force-quit, and works offline.
- **Export backup** in More downloads a JSON copy of every list, item, recipe, planned meal, and
  setting. On browsers that support it, **Share backup** opens the system share sheet; otherwise
  **Copy backup** puts the JSON on the clipboard. **Restore from file** validates the backup first,
  shows what it contains, and only replaces data after you confirm. A corrupt or newer-version file
  is rejected without touching existing data.
- **Search Google Drive** opens a prefilled Drive search for `grocery-planner-backup` in a new tab.
  Download the newest backup there, return to More, and use **Restore from file**. No Google
  sign-in, OAuth client ID, or Drive permission is requested by the app. The system file picker
  used by **Restore from file** can also browse Google Drive directly on iPhone and Android when
  the Drive app is installed.
- **Use a shared Google Drive folder for two phones.** Keep the newest backup there. Export on the
  phone with the latest edits, then open that file with **Restore from file** on the other phone.
  Import replaces local data, so don’t edit both phones independently and expect a merge.
- **Install app** appears in More when Chrome or Edge offers an install prompt. On iPhone and iPad,
  follow the Share → Add to Home Screen steps in the same card.
- More also has an optional **Keep the screen awake in List** switch. It uses the Screen Wake Lock
  API when the browser supports it, so the phone does not lock while you shop; it is reacquired when
  you return to the tab and can still be overridden by battery saver.
- Storage failures (private mode, quota) surface as a banner instead of failing silently.

## Data and privacy

- There is no analytics, no third-party script, and the app makes no network requests after the
  initial load.
- Data will live in one IndexedDB document on the device (plus a localStorage fallback).
- The Google Calendar handoff and Google Drive search are normal links. The list is placed in the
  Calendar URL only when you tap **Open Google Calendar**; Drive search opens Google Drive in a new
  tab. Nothing is sent by the app until you choose to continue on those pages.
- **iPhone caveat:** Safari can evict site storage after about seven days of non-use. Installing to
  the Home Screen protects against this. Download a backup from More regularly and keep the newest
  copy in the shared Drive folder or another safe place.
- A backup is plain JSON. Treat it like a photo of your shopping list, not a secret document.

## Troubleshooting

**"Offline support is not active" / no install prompt**
Serve over HTTP(S), not `file://`. On iPhone, installs go through Share → Add to Home Screen; there
is no automatic prompt.

**Stale version after deploying**
Check that both `VERSION` constants were bumped. In Safari, remove the Home Screen app and re-add it
if it is truly stuck.

**`git` exits with code 69**
Accept the Xcode license once: `sudo xcodebuild -license accept`.
d -license accept`.
