/* More — build info, storage status, install help, roadmap. */

import { VERSION } from '../config.js';
import * as store from '../store.js';
import { checkForUpdates } from '../pwa.js';

const MODE_LABELS = {
  indexeddb: 'IndexedDB (this device)',
  localstorage: 'Local storage (this device)',
  memory: 'Not saved',
};

export function mount(root) {
  const info = store.getStorageInfo();
  const list = store.getActiveList();
  const lists = store.visibleLists();
  const itemCount = store.visibleItems(list).length;
  const recipeCount = store.visibleRecipes().length;

  root.innerHTML = `
    <h1 class="page-title">More</h1>
    <p class="lede">Build info, where your data lives, and what&rsquo;s coming next.</p>

    <section class="card" aria-labelledby="build-title">
      <div class="card__head">
        <h2 id="build-title">This build</h2>
        <span class="badge">Lists + recipes</span>
      </div>
      <ul class="rows">
        <li><span class="row__label">Version</span><span class="row__value">${VERSION}</span></li>
        <li><span class="row__label">Lists</span><span class="row__value">${lists.length}</span></li>
        <li><span class="row__label">Items on active list</span><span class="row__value">${itemCount}</span></li>
        <li><span class="row__label">Recipes</span><span class="row__value">${recipeCount}</span></li>
        <li><span class="row__label">Storage</span><span class="row__value">${MODE_LABELS[info.mode] || info.mode}</span></li>
        <li><span class="row__label">Sharing</span><span class="row__value">Export / import (Phase 2)</span></li>
      </ul>
      <div class="btn-row">
        <button class="btn" id="check-updates" type="button">Check for updates</button>
      </div>
      <p class="card__note">
        No accounts and no server. Nothing leaves this device unless you export it or hand a
        trip to Google Calendar.
      </p>
    </section>

    ${
      info.error
        ? `<div class="banner" role="status">${info.error}</div>`
        : ''
    }

    <section class="card" aria-labelledby="install-title">
      <div class="card__head">
        <h2 id="install-title">Install on your phone</h2>
      </div>
      <p class="card__note" style="margin-top: 0">
        Installing protects your data: Safari can clear storage for sites you have not used in a
        while, but keeps installed apps.
      </p>
      <p class="eyebrow">iPhone / iPad</p>
      <ol class="steps">
        <li>Open this page in Safari.</li>
        <li>Tap the Share button, then <strong>Add to Home Screen</strong>.</li>
        <li>Launch it from the Home Screen icon from now on.</li>
      </ol>
      <p class="eyebrow">Android / Chrome</p>
      <ol class="steps">
        <li>Open this page in Chrome.</li>
        <li>Tap the three-dot menu, then <strong>Install app</strong>.</li>
      </ol>
    </section>

    <section class="card" aria-labelledby="roadmap-title">
      <div class="card__head">
        <h2 id="roadmap-title">What&rsquo;s next</h2>
      </div>
      <ul class="roadmap">
        <li class="is-done"><span class="roadmap__dot"></span>Phase 0 — installable shell</li>
        <li class="is-done"><span class="roadmap__dot"></span>Phase 1 — grocery list that persists</li>
        <li class="is-done"><span class="roadmap__dot"></span>Per-store lists and Google Calendar trips</li>
        <li class="is-done"><span class="roadmap__dot"></span>Phase 3 — recipes and seeded meals</li>
        <li class="is-current"><span class="roadmap__dot"></span>Phase 2 — backup and restore</li>
        <li><span class="roadmap__dot"></span>Phase 4 — meal plan and list generation</li>
        <li><span class="roadmap__dot"></span>Phase 5 — merge between two phones</li>
      </ul>
    </section>
  `;

  const updatesButton = root.querySelector('#check-updates');
  if (updatesButton) updatesButton.addEventListener('click', checkForUpdates);
}
