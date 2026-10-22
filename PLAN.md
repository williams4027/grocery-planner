# Grocery Planner — Project Plan

A local-first PWA for weekly meal planning and grocery shopping, shared between two phones by
exporting/importing a JSON file. Hosted free on GitHub Pages.

- **Live URL:** `https://cheers-studios.com/grocery-planner/` (custom domain; the
  `williams4027.github.io` URL redirects here).
- **Stack:** plain HTML + CSS + ES modules, no bundler, no build step
- **Storage:** IndexedDB (single state document) with localStorage fallback
- **Sync:** manual export/import only (no server, no accounts, no network calls)

**Status:** Phases 0–1 implemented, plus per-store lists, Google Calendar trip export, seeded
recipes, item/recipe editing, JSON backup/restore, weekly meal planning, and shopping/list-
management polish. Two-phone merge is next.

---

## 1. Goals and non-goals

### Goals
- Plan meals for the week on a phone, then shop from an auto-generated list.
- Fast, thumb-friendly shopping mode that works fully offline.
- Data lives only on the device; moving data between phones is an explicit file export/import.
- Deploy on every increment; usable on a real phone from Phase 0.
- Zero build tooling, zero dependencies, zero hosting cost.

### Non-goals (for now)
- Live multi-device sync, accounts, or a backend.
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
  list, scaled by `planned servings / recipe servings`. Each item keeps `sourceRecipeId` and
  `sourcePlanEntryId`, so changing or clearing that meal can remove its unchecked items without
  touching checked ones. Custom/free-text meals stay on the plan without adding ingredients.
- **Shop:** check items off one-handed; checked items sink to the bottom of their aisle; list
  survives app kill and offline reloads.
- **Share:** export produces `grocery-planner-backup-YYYY-MM-DD.json`; send via
  AirDrop/iMessage/Files. Import validates and replaces after confirmation; merge is Phase 5.
- **Backup nudge:** if no export in N days, show a dismissible banner on the list screen.

### Data model sketch
```json
{
  "format": "grocery-planner-backup",
  "formatVersion": 1,
  "schemaVersion": 1,
  "appVersion": "0.9.1",
  "exportedAt": "2026-10-22T15:00:00.000Z",
  "state": {
    "recipes": [{
      "id": "rcp_1", "title": "Sheet-pan chicken", "servings": 4,
      "ingredients": [{ "name": "chicken thighs", "qty": 2, "unit": "lb", "aisle": "Meat & Seafood" }],
      "steps": ["..."], "tags": ["weeknight"], "sourceUrl": null,
      "createdAt": "...", "updatedAt": "...", "deletedAt": null
    }],
    "plan": [{
      "id": "pln_1", "date": "2026-10-26", "slot": "dinner",
      "recipeId": "rcp_1", "title": "Sheet-pan chicken", "servings": 4,
      "createdAt": "...", "updatedAt": "..."
    }],
    "lists": [{
      "id": "lst_1", "name": "Costco", "storeKey": "costco",
      "aisleOrder": ["Household", "Pantry", "Frozen", "Dairy", "Meat & Seafood", "Produce", "Bakery", "Other"],
      "createdAt": "...", "updatedAt": "...", "archivedAt": null,
      "items": [{
        "id": "itm_1", "name": "chicken thighs", "qty": 2, "unit": "lb",
        "aisle": "Meat & Seafood", "checked": false, "note": null,
        "sourceRecipeId": "rcp_1", "sourcePlanEntryId": "pln_1",
        "addedAt": "...", "updatedAt": "...", "deletedAt": null
      }]
    }],
    "settings": {
      "weekStart": "sun",
      "aisleOrder": ["Produce", "Meat & Seafood", "Dairy", "Bakery", "Frozen", "Pantry", "Household", "Other"],
      "activeListId": "lst_1",
      "theme": "system", "lastExportAt": null, "backupNudgeDays": 14,
      "recipeSeedVersion": 1
    }
  }
}
```

**Merge rule:** union by `id`; for the same `id`, keep the record with the newer `updatedAt`
(last-write-wins). Deletes are tombstones (`deletedAt` set), not removals, so a deleted item does
not resurrect from the other phone's copy. Tombstones are pruned after ~90 days on export.
**Schema version:** refused if newer than the app understands; migrated forward if older.

### Deliberate simplifications
- Quantity is a number + free-text unit. Merging sums only when name and unit match exactly.
- Aisle assignment is a small keyword map plus manual override; unmatched → "Other".
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
│   ├── calendar.js         # Google Calendar trip details + URL builder (pure)
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

### Phase 2.5 — List refinement (done, v0.9.1)
- Adding an item that matches an existing row on the target list combines quantities instead of
  creating a duplicate. Matching ignores name/unit case, simple unit plurals, and common ingredient
  name plurals such as egg/eggs. A one-time upgrade cleanup merges duplicate rows saved by older
  versions while keeping separate planned meals distinct.
- The item edit sheet exposes **Move to**; saving with another list selected moves the row, merging
  with a matching target row when possible. Manual/recipe additions and moves share the merge logic.
- Seed recipe ingredients were normalized to one lowercase grocery vocabulary with canonical
  alternatives and cleaned optional/prep wording. Untouched seed recipes are refreshed on upgrade;
  edited and deleted recipes are left alone.
- **Accept:** add “2 cups flour” twice and see one row with 4 cups; move it to another list; reload
  and confirm both lists persist. Done.

### Phase 3 — Recipes (done, v0.5.1; reorder and scaling queued)
- Recipe list with search and category filters; create/edit form with a simple ingredient textarea.
- Ingredient model: name, qty, unit, aisle (auto-suggested); leading quantities are parsed.
- Recipe detail with edit and "add ingredients to list" (any visible list) without scaling.
- Twenty recipes seeded from the household meal-planning sheet, guarded by a seed marker.
- Still queued: reorder/duplicate recipes and scale ingredients by servings.
- **Accept:** edit a seeded recipe and add its ingredients to a chosen list offline.

### Phase 4 — Weekly meal plan (done, v0.7.0)
- Week view: 7 days × 3 slots, prev/next week, "today" jump; assign recipe or free text.
- Servings per entry; copy last week into empty slots; clear day.
- Choosing a recipe automatically adds scaled ingredients to the selected list with
  `sourceRecipeId` and `sourcePlanEntryId`. Updating or clearing a meal removes only that meal's
  unchecked items; checked items are kept.
- **Accept:** plan 5 dinners, see their ingredients on the chosen list, shop, check off; plan
  persists offline. Done: plan entries and automatic additions survive reload.

### Phase 5 — Two-phone merge (1–2 days)
- Merge import (union by id, last-write-wins, tombstones), preview counts (new/updated/deleted).
- `deviceId` + `lastModifiedBy` surfaced subtly ("updated on Blake's phone").
- Backup nudge banner after `backupNudgeDays`; tombstone pruning.
- **Accept:** both phones edit different items → merge keeps both. Delete on A, edit on B → no
  zombie resurrection. Round-trip A → B → A is stable (idempotent).

### Phase 6 — Polish pass (1–2 days)
- Install help page per platform (iOS Share → Add to Home Screen; Android/desktop install button).
- Chrome/Edge install UX: capture `beforeinstallprompt`, show an "Install app" button in More, and
  hide it on iOS where the event never fires; listen for `appinstalled`.
- Service worker update toast ("New version — reload"), version stamped in Settings.
- Screen Wake Lock in shopping mode (best effort, ignored if unsupported).
- Print stylesheet for the list; dark mode; reduced-motion; focus states; ARIA labels.
- Web Share API for export when available, clipboard fallback.
- `README.md` with architecture, deploy steps, and "how to release" checklist.
- **Accept:** Lighthouse PWA/installability passes; VoiceOver reads list items and check state.

### Phase 7 — Optional extras (backlog)
- ICS export of the meal plan (import to Apple/Google Calendar).
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
| Two-phone merge creates duplicates | Stable IDs, normalized name+unit keys, merge preview before commit. |
| Safari quirks in standalone mode | Test on-device every phase; avoid `navigator.share` as the only export path. |
| Scope creep (prices, nutrition, sync) | Explicit non-goals; Phase 7 backlog. |

---

## 7. Definition of done

- Installed on both phones from the Pages URL, works in airplane mode.
- A week can be planned, a list generated, and shopping completed without a network.
- Data survives force-quit and phone reboot; export/import round-trips cleanly between phones.
- No network requests at runtime beyond the initial asset load.
