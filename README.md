# Grocery Planner

A local-first PWA for weekly meal planning and grocery shopping, built to live on GitHub Pages and
be installed from Safari on an iPhone.

- **No build step.** Plain HTML, CSS, and ES modules. Node is only used for the dev server and icon
  generation.
- **No backend, no accounts.** All data stays in the browser (IndexedDB). Sharing between phones is
  an explicit JSON export/import.
- **Offline by default.** A service worker caches the app shell, so it opens in airplane mode.
- **Free hosting.** GitHub Pages, served from `https://<user>.github.io/grocery-planner/`.

Status: **Phase 0 — installable shell.** See [PLAN.md](./PLAN.md) for the full roadmap.

## Quick start

```sh
node dev-server.js
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
node scripts/make-icons.js
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
5. Wait for the Pages build, then open `https://<your-username>.github.io/grocery-planner/` on your
   phone. In Safari: **Share → Add to Home Screen**.

## Release checklist

Every deploy:

- [ ] Bump `VERSION` in `js/app.js` (shown in More).
- [ ] Bump `VERSION` in `sw.js` (invalidates the shell cache — **required**, or phones keep old
      files).
- [ ] Add any new shell files to `SHELL_ASSETS` in `sw.js`.
- [ ] `node --check js/app.js && node --check sw.js`
- [ ] Commit, push, and open the Pages URL on a phone.
- [ ] On the phone: verify the version in More and test with airplane mode on.
- [ ] If the update doesn't appear, close and reopen the app; the update toast should reload it.

## Project structure

```
index.html              app shell, meta tags, tab bar
app.css                 design tokens, layout, preview styles
manifest.webmanifest    install metadata and icons
sw.js                   offline caching and update behaviour
js/app.js               router, views, network status, SW registration
dev-server.js           zero-dependency static server
scripts/make-icons.js   generates PNG icons (no image tooling required)
icons/                  generated PWA icons
PLAN.md                 product plan, data model, phase breakdown
```

## Data and privacy

- There is no analytics, no third-party script, and no network request after the initial load.
- Data will live in one IndexedDB document on the device (plus a localStorage fallback).
- **iPhone caveat:** Safari can evict site storage after about seven days of non-use. Installing to
  the Home Screen protects against this. Export regularly once backup exists (Phase 2).
- An exported file is plain JSON. Treat it like a photo of your shopping list, not a secret
  document.

## Troubleshooting

**"Offline support is not active" / no install prompt**
Serve over HTTP(S), not `file://`. On iPhone, installs go through Share → Add to Home Screen; there
is no automatic prompt.

**Stale version after deploying**
Check that both `VERSION` constants were bumped. In Safari, remove the Home Screen app and re-add it
if it is truly stuck.

**`git` exits with code 69**
Accept the Xcode license once: `sudo xcodebuild -license accept`.
