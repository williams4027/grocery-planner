# Grocery Planner — Project Plan

A local-first PWA for weekly meal planning and grocery shopping, moved between phones by
backing up to a shared Google Drive folder. Hosted free on GitHub Pages.

- **Live URL:** `https://cheers-studios.com/grocery-planner/` (custom domain; the
  `williams4027.github.io` URL redirects here).
- **Stack:** plain HTML + CSS + ES modules, no bundler, no build step
- **Storage:** IndexedDB (single state document) with localStorage fallback
- **Sync:** manual export/import only (no server, no Grocery Planner accounts, no background sync)

**Status:** Phases 0–6 implemented, plus per-store lists, Google Calendar trip export, recipe
ordering/duplication, weekly meal planning, `.ics` calendar export, JSON backup/restore, bulk list
actions, alphabetical aisle sorting, a Google Drive backup search shortcut, and
shopping/list-management polish. Multi-device sharing is a manual backup/restore handoff through a
shared Google Drive folder. There is no automatic merge or live sync.

---

## 1. Goals and non-goals

### Goals
- Plan meals for the week on a phone, then shop from an auto-generated list.
- Fast, thumb-friendly shopping mode that works fully offline.
- Data lives only on the device; moving data between phones is an explicit file export/import.
- Deploy on every increment; usable on a real phone from Phase 0.
- Zero build tooling, zero dependencies, zero hosting cost.

### Non-goals (for now)
- Live multi-device sync, Grocery Planner accounts, automatic merge, or a backend.
- Google Drive OAuth/API access inside the app. **Search Google Drive** is a link to Drive's own
  search; the app never connects to a Google account.
- Unit conversion math, nutrition tracking, price comparison, barcode scanning.
- iOS/Android native apps.

### Known constraints
- **Node 14 is installed**; no modern bundler. Hence the build-free stack. (Upgrading Node is
  optional later if we want Playwright tests or a bundler.)
- **Safari storage eviction:** iOS deletes site data after ~7 days of non-use *unless* the site is
  added to the Home Screen. Onboarding must push "Add to Home Screen", and the app should nag
  about backups.
- **GitHub Pages subpath:** the site lives under `/grocery-planner/`, so every asset URL and route
  must be relative. No leading-slash paths, no `pushState` routing — use hash routes (`#/list`).
- **Shared origin:** `cheers-studios.com` may host other projects, and browser storage is scoped per
  origin, not per path. IndexedDB database and localStorage keys must be namespaced
  (`grocery-planner`) so they cannot collide with another app on the same domain.
- **Pages requires a public repo** on free accounts (private + Pages needs GitHub Pro).
- **`gh` CLI is not installed.** Repo creation is either manual in the browser or `brew install gh`.

---

## 2. Product outline

### Core objects
| Object | Purpose |
| --- | --- |
| **Recipe** | Title, servings, ingredient lines, steps, tags, optional source URL. |
| **Meal plan entry** | Date + slot (breakfast/lunch/dinner) + recipe or free text + servings. |
| **Grocery list** | Named list of items with aisle, quantity, checked state, notes; optionally tied to a store layout. |
| **Settings** | Aisle order, active list, week start, theme, last-backup reminder. |

### Main screens (hash routes)
1. `#/plan` — current week grid (7 days × 3 slots), tap a slot to assign a recipe or text.
2. `#/list` — active grocery list in shopping mode: grouped by aisle, big checkboxes, sticky
   aisle headers, running "x of y picked" counter. Store chips switch between Kroger, Whole Foods,
   Costco, and custom lists.
3. `#/recipes` — recipe list, search/filter, detail, add-to-list, and create form.
4. `#/list` → **Manage lists** sheet — create, duplicate, archive, and restore lists.
5. `#/more` — build info, backup/restore, install help, roadmap, data counts.

Bottom tab bar for Plan / List / Recipes / More.

### Signature flows
- **Plan → shop:** choosing a recipe for a slot immediately adds its ingredients to the selected
  list, scaled by `planned servings / recipe servings`. Each item keeps `sourceRecipeId` plus
  `sourcePlanEntryId` or per-entry `planContributions`, so changing or clearing that meal can remove
  only its unchecked share without touching checked ones. Custom/free-text meals stay on the plan
  without adding ingredients.
- **Shop:** check items off one-handed; checked items sink to the bottom of their aisle; list
  survives app kill and offline reloads.
- **Share:** export produces `grocery-planner-backup-YYYY-MM-DD.json`; use the system share sheet
  when available, copy the JSON to the clipboard, or save the downloaded file into a shared Google
  Drive folder. **Search Google Drive** opens a prefilled Drive search in a new tab so the newest
  backup can be found without navigating Drive manually; download it, then use **Restore from
  file**. On the other phone, **Restore from file** validates the backup and replaces local data
  after confirmation. The shared folder is the multi-device handoff; there is no merge.
- **Backup reminder:** More shows the last backup time. A dismissible nudge is still an optional
  backlog idea.

### Data model sketch
```json
{
  "format": "grocery-planner-backup",
  "formatVersion": 1,
  "schemaVersion": 1,
  "appVersion": "0.9.6",
  "exportedAt": "2026-10-22T15:00:00.000Z",
  "state": {
    "recipes": [{
      "id": "rcp_1", "title": "Sheet-pan chicken", "servings": 4,
      "ingredients": [{ "name": "chicken thighs", "qty": 2, "unit": "lb", "aisle": "Meat & Seafood" }],
      "steps": ["..."], "tags": ["weeknight"], "sourceUrl": null, "position": 0,
      "createdAt": "...", "updatedAt": "...", "deletedAt": null
    }],
    "plan": [{
      "id": "pln_1", "date": "2026-10-26", "slot": "dinner",
      "recipeId": "rcp_1", "title": "Sheet-pan chicken", "servings": 4,
      "createdAt": "...", "updatedAt": "..."
    }],
    "lists": [{
      "id": "lst_1", "name": "Costco", "storeKey": "costco",
      "aisleOrder": ["Household", "Pantry", "Frozen", "Dairy", "Deli", "Meat & Seafood", "Produce", "Bakery", "Other"],
      "createdAt": "...", "updatedAt": "...", "archivedAt": null,
      "items": [{
        "id": "itm_1", "name": "chicken thighs", "qty": 2, "unit": "lb",
        "aisle": "Meat & Seafood", "checked": false, "note": null,
        "sourceRecipeId": "rcp_1", "sourcePlanEntryId": "pln_1",
        "planContributions": { "pln_1": 2 },
        "addedAt": "...", "updatedAt": "...", "deletedAt": null
      }]
    }],
    "settings": {
      "weekStart": "sun",
      "aisleOrder": ["Produce", "Deli", "Meat & Seafood", "Dairy", "Pantry", "Frozen", "Bakery", "Household", "Other"],
      "activeListId": "lst_1",
      "theme": "system", "lastExportAt": null, "backupNudgeDays": 14,
      "recipeSeedVersion": 1, "itemMergeVersion": 2
    }
  }
}
```

**Sharing rule:** backup and restore replaces the whole local state. Keep one latest backup in a
shared Google Drive folder; export on the phone with the newest edits, then restore that file on
the other phone. Do not edit both phones independently and expect changes to combine. Deletes are
soft (`deletedAt`) locally, but import does not merge or prune them.
**Schema version:** refused if newer than the app understands; migrated forward if older.

### Deliberate simplifications
- Quantity is a number + free-text unit. Adding the same item to a list combines quantities only
  when name and unit match exactly.
- Aisle assignment is a small keyword map plus manual override; unmatched → "Other".
- Recipe order is a per-category `position`; duplicates are inserted directly after the original.
- One active shopping list at a time. Store lists are independent, each with its own aisle order.
- No user auth. Anyone with the file has the data — treat exports like a photo, not a secret doc.

---

## 2b. Setup blockers to clear before Phase 0

1. **Xcode license not accepted** — `/usr/bin/git` exits with code 69, so no commits or pushes are
   possible. Fix in Terminal (needs your password, so I can't do it for you):
   `sudo xcodebuild -license accept`
   If you'd rather not, install git without Xcode: `brew install git` and put it ahead of
   `/usr/bin` on `PATH`.
2. **`python3` is also unusable** for the same reason (killed on launch). Local preview will use a
   ~30-line `dev-server.cjs` on Node 14 instead (`node dev-server.cjs` → port 8000).
3. **`gh` CLI missing** — either create the repo in the browser, or `brew install gh` to create it
   and enable Pages from the terminal.
4. **Git identity unset** — `git config --global user.name "..."` and `user.email "..."`.

Everything else (Node 14, npm, Safari) is fine for this stack, since there is no build step.

---

## 3. File layout

```
/
├── index.html              # app shell, meta tags, hash-route host
├── app.css                 # layout, themes, print + shopping-mode styles
├── manifest.webmanifest    # name, icons, display: standalone, theme colors
├── sw.js                   # precache shell + stale-while-revalidate for js/css
├── .nojekyll               # keep Pages from running Jekyll
├── dev-server.cjs          # tiny Node static server for localhost testing
├── icons/                  # 192, 512, maskable 512, apple-touch 180
├── js/
│   ├── app.js              # boot, hash router, tab bar, network status
│   ├── config.js           # name, version, schema version, aisles, store presets, storage keys
│   ├── model.js            # factories, aisle keywords, normalization
│   ├── dates.js            # local date keys, week starts, day arithmetic
│   ├── calendar.js         # Google Calendar details, URL builder, and .ics export (pure)
│   ├── backup.js           # JSON backup format, validation, restore
│   ├── store.js            # state container, IndexedDB persistence, subscribe()
│   ├── seed-recipes.js     # recipes imported from the meal-planning sheet
│   ├── sheet.js            # shared bottom-sheet dialog controller
│   ├── pwa.js              # service worker registration, update checks
│   ├── ui.js               # tiny DOM helpers, icons, toast
│   └── views/              # plan.js, list.js, recipes.js, more.js
├── PLAN.md
└── README.md
```

No framework. Each view exports `mount(root)` and returns an optional cleanup function.

---

## 4. Phase plan (each phase ships to Pages)

> Every phase ends with: push to `main` → Pages redeploys → open the live URL on the
> iPhone and confirm the acceptance criteria.

### Phase 0 — Deploy a real PWA shell (½ day) — **done**
- `git init`, `.gitignore`, README, `.nojekyll`.
- `dev-server.cjs` so the app can be tested over HTTP (service workers require it).
- `index.html` with a "Hello, grocery" screen, `app.css` base tokens (system font, light/dark).
- `manifest.webmanifest` + icons; `sw.js` caching the shell.
- `js/app.js` with hash router stub and offline status indicator.
- Create public GitHub repo, push, enable Pages (branch `main`, `/` root).
- **Accept:** URL loads on phone; Add to Home Screen shows icon and standalone window; airplane
  mode + reload still renders the app.
- **Why first:** proves HTTPS, base path, icons, and the install flow before any logic exists.

### Phase 1 — Grocery list MVP, offline-persistent (1–2 days) — **done**
- `store.js`: IndexedDB `kv` store holding one state doc, debounced writes, localStorage fallback,
  `subscribe()` for re-render; hydrate on boot with a loading state. Namespace the IndexedDB
  database (`grocery-planner`) and the localStorage key (`grocery-planner:state:v1`) because the
  custom domain's origin is shared with other projects.
- Single list: add item (name + optional qty/unit), toggle, delete, rename list.
- Group by aisle using the keyword map; sticky headers; counter.
- Empty states and a "storage unavailable (private mode)" warning.
- **Accept:** add 10 items, force-quit Safari, reopen — all still there, offline. No layout jank
  with the keyboard open on iPhone.

### Phase 1.5 — Per-store lists + Google Calendar (done, v0.4.0)
- Independent lists for Kroger, Whole Foods, Costco, and custom stores; store chips switch in one tap.
- Presets set the list name and reorder existing aisles (no new categories).
- `settings.activeListId` remembers the last list; old single-list data migrates silently.
- The Add item sheet can target any visible list; adding to a different list switches the active
  list so the result is visible.
- Tap the pencil on an item to edit its name, quantity, or description; the aisle is re-suggested
  from the new name and checked state is preserved.
- **Calendar handoff:** a sheet collects title/date/time, then opens a prefilled Google Calendar
  event with the list grouped by aisle in the description. No OAuth, no backend.
- **Accept:** create three store lists, switch between them, reload, and open a prefilled trip event
  with the correct items and aisle order.

### Phase 2 — Backup/restore + shopping polish (done, v0.8.0)
- **Export/import v1:** download JSON, import with Replace only; validation + error messages.
- Settings screen with data counts, export button, and last-backup timestamp.
- Backup files include every list, item, recipe, planned meal, and setting; restores show a summary
  and require confirmation. Corrupt or newer-version files are rejected atomically.
- Shopping mode polish: 44px+ targets, checked items dim and sink, per-aisle progress, undo on
  delete, swipe-free (buttons only).
- Multiple lists: duplicate (including checked items), archive without deleting data, and restore
  from the **Manage lists** sheet. The last visible list cannot be archived.
- **Accept:** export on phone A → import on phone B → identical list. Import of a corrupt file
  fails safely without touching existing data. Done.

### Phase 2.5 — List refinement (done, v0.9.2)
- Adding an item that matches an existing row on the target list combines quantities instead of
  creating a duplicate. Matching ignores name/unit case, simple unit plurals, and common ingredient
  name plurals such as egg/eggs. A one-time upgrade cleanup merges duplicate rows saved by older
  versions.
- Planned meals that share an ingredient share one combined row. Each meal records its own quantity
  contribution, so updating or clearing one meal removes only that meal’s share and leaves checked
  rows untouched.
- The item edit sheet exposes **Move to**; saving with another list selected moves the row, merging
  with a matching target row when possible. Manual/recipe additions and moves share the merge logic.
- Seed recipe ingredients were normalized to one lowercase grocery vocabulary with canonical
  alternatives and cleaned optional/prep wording. Untouched seed recipes are refreshed on upgrade;
  edited and deleted recipes are left alone.
- **Accept:** add “2 cups flour” twice and see one row with 4 cups; move it to another list; reload
  and confirm both lists persist. Done.

### Phase 2.6 — Bulk list actions (done, v0.9.3)
- **Select** turns list rows into selection checkboxes without changing their picked state. The
  bottom action bar can select/deselect all, move the selected rows to another list, delete them,
  or clear the entire list.
- Moving several rows uses one commit and the same matching rules as a single move: matching target
  rows combine quantities and per-meal contributions, and checked rows stay checked only when both
  copies were already picked up.
- Bulk delete and clear list use one commit each and show an **Undo** toast. Clearing asks for
  confirmation first; undoing restores every cleared row.
- Selection is scoped to the active list and exits automatically after a move, delete, clear, or
  list switch.
- **Accept:** select two rows, move them to another list, combine a matching quantity, clear the
  source list, and undo both actions. Done.

### Phase 2.7 — Alphabetical list sorting (done, v0.9.4)
- Items stay grouped in store-aisle order, but each aisle now sorts A–Z by item name. Matching is
  case-insensitive and uses natural number ordering.
- Picked items still sink to the bottom of their aisle and are also sorted A–Z there.
- **Accept:** add eggs, milk, and flour to the same aisle and see eggs, flour, milk. Done.

### Phase 2.8 — Manual aisle control (done, v0.9.5)
- Added **Deli** to the known aisles. The default route is Produce → Deli → Meat & Seafood → Dairy
  → Pantry → Frozen → Bakery → Household → Other. Lists saved before this release gain Deli after
  Produce during normalization rather than at the bottom.
- The add/edit item sheet gives every field a visible label above its input and adds an **Aisle**
  selector. **Auto** keeps keyword suggestions; choosing an aisle stores an explicit override, and
  `updateItem()` no longer replaces it with the keyword suggestion.
- Each recipe ingredient has an **Aisle** selector in the recipe detail. Changes commit
  immediately, and aisle overrides survive recipe text edits when the ingredient name is unchanged.
- **Manage lists → Aisles** opens a per-list ordering sheet with up/down controls and a reset to
  the list’s store-preset order. Ordering is local to that list, not global.
- **Accept:** add “milk” to Deli, add a recipe with an ingredient manually placed in Frozen, edit
  and resave the recipe, confirm both overrides persist; reorder a list’s aisles and reload. Done.

### Phase 3 — Recipes (done, v0.9.4)
- Recipe list with search and category filters; create/edit form with a simple ingredient textarea.
- Ingredient model: name, qty, unit, aisle (auto-suggested and manually overridable); leading
  quantities are parsed.
- Recipe detail with edit, duplicate, and "add ingredients to list" (any visible list).
- Manual ordering inside each category with **Move up** / **Move down**; duplicates are named
  “copy” and inserted directly after the original.
- Twenty recipes seeded from the household meal-planning sheet, guarded by a seed marker.
- Recipe-level serving scaling is intentionally deferred and may be removed for simplicity; the
  meal plan still scales ingredients by planned servings.
- **Accept:** edit a seeded recipe, reorder it, duplicate it, and add its ingredients to a chosen
  list offline. Done.

### Phase 4 — Weekly meal plan (done, v0.7.0; .ics export added v0.9.4)
- Week view: 7 days × 3 slots, prev/next week, "today" jump; assign recipe or free text.
- Servings per entry; copy last week into empty slots; clear day.
- Choosing a recipe automatically adds scaled ingredients to the selected list with
  `sourceRecipeId` and per-meal quantity contributions. Updating or clearing a meal removes only
  that meal's unchecked share; checked items are kept.
- **Download .ics:** export the visible week as all-day calendar events for Apple or Google
  Calendar. The file is built locally; nothing is uploaded.
- **Accept:** plan 5 dinners, see their ingredients on the chosen list, shop, check off; plan
  persists offline. Export the week, import the `.ics` file, and see the meals on a calendar. Done.

### Phase 5 — Shared-folder backup handoff (done, v0.9.4)
- Supported multi-device workflow: keep the latest `grocery-planner-backup-YYYY-MM-DD.json` in a
  shared Google Drive folder (or any shared file location).
- Export on the phone with the newest edits, then **Restore from file** on the other phone. Import
  validates first and replaces all local data after confirmation.
- No device IDs, automatic merge, last-write-wins, tombstones, or background sync. Coordinate edits
  instead of editing both phones at the same time.
- Backup nudge and tombstone pruning remain optional backlog ideas; last-backup time is visible in
  More.
- **Accept:** export on phone A, save to the shared folder, restore that file on phone B, and see
  the same lists, recipes, and plan. Done.

### Phase 5.1 — Google Drive backup search shortcut (done, v0.9.6)
- More adds **Search Google Drive**, a normal link to
  `https://drive.google.com/drive/search?q=grocery-planner-backup`, opened in a new tab.
- The user downloads the chosen backup and completes the existing **Restore from file** flow.
- No OAuth, API key, Google Identity Services script, access token, or client-ID setup. The app
  does not connect to a Google account or read Drive directly.
- The system file picker used by **Restore from file** still browses Google Drive directly on
  iPhone and Android when the Drive app is installed.
- **Accept:** tap Search Google Drive, find the newest backup, download it, and restore it on the
  other phone without configuring Google Cloud. Done.

### Phase 6 — Polish pass (done, v0.9.3)
- Install help page per platform (iOS Share → Add to Home Screen; Android/desktop install button).
- Chrome/Edge install UX: capture `beforeinstallprompt`, show an "Install app" button in More, and
  hide it on iOS where the event never fires; listen for `appinstalled`.
- Service worker update toast ("New version — reload"), version stamped in Settings.
- Optional Screen Wake Lock in List (best effort, reacquired when the tab becomes visible, ignored
  if unsupported or denied).
- Print stylesheet for the list; dark mode; reduced-motion; focus states; ARIA labels.
- Web Share API for export when available, clipboard fallback, and the existing download fallback.
- `README.md` with architecture, deploy steps, and "how to release" checklist.
- **Accept:** Lighthouse PWA/installability passes; VoiceOver reads list items and check state.

### Phase 7 — Optional extras (backlog)
- Backup nudge banner after `backupNudgeDays`.
- Staples / "buy again" suggestions from checked history.
- `404.html` redirect shim if we ever want path routing instead of hash routes.
- Custom domain via `CNAME`.
- Optional: upgrade Node → add Playwright smoke tests + GitHub Actions on PR.
- Optional: encrypted export (passphrase) if the file ever leaves the household.

---

## 5. Deployment runbook

**One-time setup**
1. Set git identity (`git config user.name/user.email`) — currently unset.
2. Create a **public** repo `grocery-planner` on GitHub (browser or `brew install gh`).
3. `git remote add origin git@github.com:<user>/grocery-planner.git` (or HTTPS).
4. `git push -u origin main`.
5. Repo → Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)` → Save.
6. Wait for the Pages build, open `https://cheers-studios.com/grocery-planner/`.

**Every release after that**
1. Bump `VERSION` in `js/config.js` and `sw.js` (critical — otherwise phones keep the old shell).
2. Update the cache list only if the file set changed (shell is precached; `js/` and `css` use
   stale-while-revalidate).
3. Commit + push; verify on phone; use Settings → "Reload to update" if the toast lags.

**Local preview** (service workers need HTTP, not `file://`):
`node dev-server.cjs` → <http://localhost:8000>. Test offline via DevTools → Network → Offline, and
on the phone via airplane mode. (Python's `http.server` would work too, but `python3` is currently
blocked by the Xcode license, so the project ships its own tiny Node server.)

---

## 6. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| iOS evicts storage after ~7 days unused | Push Home Screen install; backup nudge; one-tap export to Files. |
| Photos/notes lost after phone change | Export reminder + "last backup" in Settings; import test in Phase 2. |
| Service worker serves stale app | Cache versioning, update toast, short cache TTL for `js/`. |
| Subpath breaks assets on Pages | All URLs relative (`./js/app.js`), no leading slashes, hash routing. |
| Two phones overwrite each other | One shared-folder handoff at a time; export before switching phones and keep the latest file. |
| Safari quirks in standalone mode | Test on-device every phase; avoid `navigator.share` as the only export path. |
| Scope creep (prices, nutrition, sync) | Explicit non-goals; Phase 7 backlog. |

---

## 7. Definition of done

- Installed on both phones from the Pages URL, works in airplane mode.
- A week can be planned, a list generated, and shopping completed without a network.
- Data survives force-quit and phone reboot; export/import round-trips cleanly between phones.
- No app-initiated network requests at runtime beyond the initial asset load. The optional Google
  Calendar and Google Drive actions are ordinary links you choose to open.
