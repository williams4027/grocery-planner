# Grocery Planner

A local-first PWA for weekly meal planning and grocery shopping, built to live on GitHub Pages and
be installed from Safari on an iPhone.

- **No build step.** Plain HTML, CSS, and ES modules. Node is only used for the dev server and icon
  generation.
- **No backend, no accounts.** All data stays in the browser (IndexedDB). Sharing between phones is
  an explicit JSON export/import.
- **Offline by default.** A service worker caches the app shell, so it opens in airplane mode.
- **Free hosting.** GitHub Pages on a custom domain: `https://cheers-studios.com/grocery-planner/`
  (the `williams4027.github.io` URL redirects there).

Status: **Phase 1 plus per-store lists, Google Calendar trip export, seeded recipes, backup and
restore, weekly meal planning, and shopping/list-management polish.** Two-phone merge is next. See
[PLAN.md](./PLAN.md) for the full roadmap.

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
js/calendar.js          pure Google Calendar trip-detail and URL builders
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
  above the list. Each store has its own aisle order, and the active list is remembered.
- Add items from the docked **Add item** button at the bottom of the list screen; the sheet stays
  open for batch entry. If you have more than one store list, choose **Add to** (Kroger, Costco, …)
  before submitting.
- Add items with an optional quantity and description (for example, “organic” or “green”). Tap the
  pencil on any row to edit its name, quantity, or description; delete with one tap.
- Automatic aisle grouping (produce, dairy, pantry, …) with sticky headers.
- Check items off; picked items dim, sink within their aisle, and both the list counter and each
  aisle’s progress update. Delete an item with one tap and use **Undo** in the toast if needed.
- Rename the active list inline. Open **Manage lists** to duplicate a list (including its checked
  items), archive a list without deleting anything, or restore an archived list later. The last
  visible list cannot be archived.
- **Add trip to Google Calendar** opens a prefilled event with the list in the description. It is a
  link, not an account connection: you pick the title/date/time, then review and save it in Google
  Calendar.
- Browse **recipes seeded from the meal-planning sheet**, search or filter by category, and add all
  of a recipe’s ingredients to the active list or another store list in one tap. Save new recipes
  or edit a recipe’s title, category, and ingredient lines, including quantities; ingredient lines
  like “2 cups chopped carrots” are split into quantity, unit, and item name automatically.
- **Plan a week of meals** in a 7-day × 3-slot grid. Move between weeks, jump back to today, set
  servings, copy last week into empty slots, or clear a day. Choosing a recipe adds its ingredients
  to the selected list automatically, scaled to the planned servings. Updating or clearing a meal
  removes only the unchecked items it added; items you already checked off are kept.
- Everything persists in IndexedDB on the device, survives force-quit, and works offline.
- **Export backup** in More downloads a JSON copy of every list, item, recipe, planned meal, and
  setting. **Restore from file** validates the backup first, shows what it contains, and only
  replaces data after you confirm. A corrupt or newer-version file is rejected without touching
  existing data.
- Storage failures (private mode, quota) surface as a banner instead of failing silently.

## Data and privacy

- There is no analytics, no third-party script, and no network request after the initial load.
- Data will live in one IndexedDB document on the device (plus a localStorage fallback).
- The Google Calendar handoff is a normal link. The list is placed in the URL only when you tap
  **Open Google Calendar**, so nothing is sent until you choose to continue there.
- **iPhone caveat:** Safari can evict site storage after about seven days of non-use. Installing to
  the Home Screen protects against this. Download a backup from More regularly and keep it in
  Files or another safe place.
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
