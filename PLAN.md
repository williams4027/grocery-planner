# Grocery Planner — Project Plan

A local-first PWA for weekly meal planning and grocery shopping, shared between two phones by
exporting/importing a JSON file. Hosted free on GitHub Pages.

- **Live URL:** `https://cheers-studios.com/grocery-planner/` (custom domain; the
  `williams4027.github.io` URL redirects here).
- **Stack:** plain HTML + CSS + ES modules, no bundler, no build step
- **Storage:** IndexedDB (single state document) with localStorage fallback
- **Sync:** manual export/import only (no server, no accounts, no network calls)

**Status:** Phases 0–1 implemented. Phase 2 is next.

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
| **Grocery list** | Named list of items with aisle, quantity, checked state, notes. |
| **Settings** | Aisle order, week start, theme, last-backup reminder. |

### Main screens (hash routes)
1. `#/plan` — current week grid (7 days × 3 slots), tap a slot to assign a recipe or text.
2. `#/list` — active grocery list in shopping mode: grouped by aisle, big checkboxes, sticky
   aisle headers, running "x of y picked" counter.
3. `#/recipes` — recipe list + detail/edit.
4. `#/lists` — all lists, create/rename/archive/duplicate.
5. `#/settings` — aisle order, backup/restore, install help, data reset, app version.

Bottom tab bar for Plan / List / Recipes / More.

### Signature flows
- **Plan → shop:** "Generate list from this week's plan" scales each recipe's ingredients by
  `planned servings / recipe servings`, merges duplicate name+unit pairs, and adds them to a chosen
  list with a `sourceRecipeId` so items can be traced back.
- **Shop:** check items off one-handed; checked items sink to the bottom of their aisle; list
  survives app kill and offline reloads.
- **Share:** export produces `grocery-planner-YYYY-MM-DD.json`; send via AirDrop/iMessage/Files.
  Import offers **Merge** (default) or **Replace**, with a preview of what will change.
- **Backup nudge:** if no export in N days, show a dismissible banner on the list screen.

### Data model sketch
```json
{
  "schemaVersion": 1,
  "appVersion": "0.4.0",
  "deviceId": "dev_ab12",
  "exportedAt": "2026-10-22T15:00:00.000Z",
  "state": {
    "recipes": [{
      "id": "rcp_1", "title": "Sheet-pan chicken", "servings": 4,
      "ingredients": [{ "name": "chicken thighs", "qty": 2, "unit": "lb", "aisle": "Meat & Seafood" }],
      "steps": ["..."], "tags": ["weeknight"], "sourceUrl": null,
      "createdAt": "...", "updatedAt": "...", "deletedAt": null
    }],
    "plan": [{
      "id": "mp_1", "date": "2026-10-26", "slot": "dinner",
      "recipeId": "rcp_1", "servings": 4, "note": null,
      "createdAt": "...", "updatedAt": "...", "deletedAt": null
    }],
    "lists": [{
      "id": "lst_1", "name": "Week of Oct 26", "createdAt": "...", "updatedAt": "...",
      "archivedAt": null,
      "items": [{
        "id": "itm_1", "name": "chicken thighs", "qty": 2, "unit": "lb",
        "aisle": "Meat & Seafood", "checked": false, "note": null,
        "sourceRecipeId": "rcp_1", "addedAt": "...", "updatedAt": "...", "deletedAt": null
      }]
    }],
    "settings": {
      "weekStart": "sun",
      "aisleOrder": ["Produce", "Meat & Seafood", "Dairy", "Bakery", "Frozen", "Pantry", "Household", "Other"],
      "theme": "system", "lastExportAt": null, "backupNudgeDays": 14
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
- One active shopping list at a time, but history is kept.
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
│   ├── config.js           # name, version, schema version, aisles, storage keys
│   ├── model.js            # factories, aisle keywords, normalization
│   ├── store.js            # state container, IndexedDB persistence, subscribe()
│   ├── pwa.js              # service worker registration, update checks
│   ├── io.js               # export, import, validation (Phase 2)
│   ├── ui.js               # tiny DOM helpers, icons, toast
│   └── views/              # plan.js, list.js, recipes.js, more.js, (lists.js Phase 2)
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

### Phase 2 — Shopping mode + multi-list + manual backup (1–2 days)
- Shopping mode polish: 44px+ targets, checked items dim and sink, per-aisle progress, undo on
  delete, swipe-free (buttons only).
- Multiple lists: create, rename, duplicate, archive; "active list" selection.
- **Export/import v1:** download JSON, import with Replace only; validation + error messages.
- Settings screen with data counts, export button, last-export timestamp.
- **Accept:** export on phone A → import on phone B → identical list. Import of a corrupt file
  fails safely without touching existing data.

### Phase 3 — Recipes (2 days)
- Recipe list with search/tags; create/edit form with repeatable ingredient rows.
- Ingredient model: name, qty, unit, aisle (auto-suggested); reorder/duplicate recipe.
- Recipe detail with "add ingredients to list" (scale by servings).
- **Accept:** build 5 recipes on desktop, export, import on phone, add one recipe to a list.

### Phase 4 — Weekly meal plan + generate list (2 days)
- Week view: 7 days × 3 slots, prev/next week, "today" jump; assign recipe or free text.
- Servings per entry; copy last week; clear day.
- "Generate list from plan": preview of merged items, dedupe against existing unchecked items,
  confirm → add with `sourceRecipeId`.
- **Accept:** plan 5 dinners, generate list, shop, check off; plan persists offline.

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
