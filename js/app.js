/* Grocery Planner — app shell and router (Phase 0) */

const VERSION = '0.1.0';
const APP_NAME = 'Grocery Planner';

const CHECK_ICON = `
  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>`;

const EMPTY_ICONS = {
  list: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M4 6.5h2.2l1.9 9.2h9.6l2-6.9H7.2" />
      <circle cx="10" cy="19.2" r="1.4" />
      <circle cx="17" cy="19.2" r="1.4" />
    </svg>`,
  recipes: `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M5 4.5h9.5A2.5 2.5 0 0 1 17 7v12.5H7.5A2.5 2.5 0 0 1 5 17V4.5Z" />
      <path d="M8.5 8.5h5M8.5 12h5M8.5 15.5h3" />
    </svg>`,
};

const routes = {
  plan: { title: 'Plan', render: renderPlan },
  list: { title: 'List', render: renderList },
  recipes: { title: 'Recipes', render: renderRecipes },
  more: { title: 'More', render: renderMore },
};

let swRegistration = null;

/* ---------- Views ---------- */

function renderPlan() {
  const days = [
    ['Mon', 'Sheet-pan chicken', true],
    ['Tue', '', false],
    ['Wed', '', false],
    ['Thu', 'Tacos', true],
    ['Fri', '', false],
    ['Sat', '', false],
    ['Sun', '', false],
  ];

  const rows = days
    .map(
      ([day, meal, filled]) => `
        <div class="week__day">
          <span class="week__label">${day}</span>
          <div class="week__slot${filled ? ' is-filled' : ''}">
            ${meal || 'No dinner planned'}
          </div>
        </div>`
    )
    .join('');

  return `
    <h1>Meal plan</h1>
    <p class="lede">Line up the week&rsquo;s dinners, then turn them into a shopping list in one tap.</p>

    <section class="card" aria-labelledby="week-title">
      <div class="card__head">
        <h2 id="week-title">This week</h2>
        <span class="badge">Preview</span>
      </div>
      <div class="week">${rows}</div>
      <p class="card__note">Planning arrives in Phase 4. The layout is here so we can see it on a real phone early.</p>
    </section>
  `;
}

function renderList() {
  const aisles = [
    {
      name: 'Produce',
      items: [
        ['Lemons', '2', false],
        ['Baby spinach', '1 bag', false],
      ],
    },
    {
      name: 'Meat &amp; Seafood',
      items: [
        ['Chicken thighs', '2 lb', false],
        ['Ground beef', '1 lb', true],
      ],
    },
  ];

  const groups = aisles
    .map(
      (aisle) => `
        <li>
          <h3 class="preview__aisle">${aisle.name}</h3>
          <ul class="preview">
            ${aisle.items
              .map(
                ([name, qty, done]) => `
                  <li class="preview__item${done ? ' is-done' : ''}">
                    <span class="preview__box" aria-hidden="true">${done ? CHECK_ICON : ''}</span>
                    <span class="preview__name">${name}${done ? '<span class="sr-only"> (picked)</span>' : ''}</span>
                    <span class="preview__qty">${qty}</span>
                  </li>`
              )
              .join('')}
          </ul>
        </li>`
    )
    .join('');

  return `
    <h1>Grocery list</h1>
    <p class="lede">Aisle by aisle, one thumb, no signal required.</p>

    <section class="card" aria-labelledby="sample-title">
      <div class="card__head">
        <h2 id="sample-title">Week of Oct 26</h2>
        <span class="badge">Preview</span>
      </div>
      <ul class="preview-groups">${groups}</ul>
      <p class="card__note">Sample items, not saved. Real lists and shopping mode arrive in Phase 1.</p>
    </section>
  `;
}

function renderRecipes() {
  return `
    <h1>Recipes</h1>
    <p class="lede">Keep the handful of meals you actually cook, with ingredients ready to add to a list.</p>

    <section class="card empty">
      <div class="empty__icon">${EMPTY_ICONS.recipes}</div>
      <h2>No recipes yet</h2>
      <p>Recipe capture lands in Phase 3, after the list and backup basics are solid.</p>
    </section>
  `;
}

function renderMore() {
  return `
    <h1>More</h1>
    <p class="lede">Build info, install help, and what&rsquo;s coming next.</p>

    <section class="card" aria-labelledby="build-title">
      <div class="card__head">
        <h2 id="build-title">This build</h2>
        <span class="badge">Phase 0</span>
      </div>
      <ul class="rows">
        <li><span class="row__label">Version</span><span class="row__value">${VERSION}</span></li>
        <li><span class="row__label">Storage</span><span class="row__value">This device only</span></li>
        <li><span class="row__label">Sharing</span><span class="row__value">Export / import</span></li>
      </ul>
      <div class="btn-row">
        <button class="btn" id="check-updates" type="button">Check for updates</button>
      </div>
      <p class="card__note">
        No accounts and no server. Nothing leaves the phone unless you export it.
      </p>
    </section>

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
      <p class="eyebrow">Android</p>
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
        <li class="is-current"><span class="roadmap__dot"></span>Phase 0 — installable shell</li>
        <li><span class="roadmap__dot"></span>Phase 1 — grocery list that persists</li>
        <li><span class="roadmap__dot"></span>Phase 2 — backup and restore</li>
        <li><span class="roadmap__dot"></span>Phase 3 — recipes</li>
        <li><span class="roadmap__dot"></span>Phase 4 — meal plan and list generation</li>
        <li><span class="roadmap__dot"></span>Phase 5 — merge between two phones</li>
      </ul>
    </section>
  `;
}

/* ---------- Router ---------- */

let activeRoute = 'plan';

// Only "#/route" hashes are routes. This keeps in-page anchors (e.g. the skip
// link's "#main") from triggering a navigation.
function routeFromHash() {
  if (!location.hash.startsWith('#/')) return null;

  const name = location.hash.replace(/^#\//, '').split('?')[0].split('/')[0];
  return Object.prototype.hasOwnProperty.call(routes, name) ? name : null;
}

function render() {
  const key = routeFromHash() || activeRoute;
  activeRoute = key;
  const route = routes[key];
  const view = document.getElementById('view');

  view.innerHTML = route.render();
  document.title = `${route.title} · ${APP_NAME}`;

  document.querySelectorAll('.tabbar a').forEach((link) => {
    if (link.dataset.route === key) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  });

  window.scrollTo({ top: 0 });
}

/* ---------- Network status ---------- */

function updateNetworkStatus() {
  const el = document.getElementById('net-status');
  const offline = !navigator.onLine;
  el.hidden = !offline;
  el.textContent = offline ? 'Offline' : '';
}

/* ---------- Toast ---------- */

let toastTimer = null;

function showToast(message, duration = 2400) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.hidden = false;

  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, duration);
}

/* ---------- Service worker ---------- */

async function checkForUpdates() {
  if (!swRegistration) {
    showToast('Offline support is still starting up.');
    return;
  }

  try {
    await swRegistration.update();
    showToast('You are up to date.');
  } catch (error) {
    console.error('Update check failed', error);
    showToast('Could not check for updates.');
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  if (location.protocol === 'file:') {
    console.warn('Service worker skipped: open the app over http://, not file://.');
    return;
  }

  const hadController = Boolean(navigator.serviceWorker.controller);

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    showToast('New version ready — reloading…', 1800);
    setTimeout(() => location.reload(), 600);
  });

  navigator.serviceWorker
    .register('./sw.js', { scope: './', updateViaCache: 'none' })
    .then((registration) => {
      swRegistration = registration;
    })
    .catch((error) => {
      console.error('Service worker registration failed', error);
    });
}

/* ---------- Boot ---------- */

document.addEventListener('click', (event) => {
  if (event.target.closest('#check-updates')) {
    checkForUpdates();
  }
});

window.addEventListener('hashchange', () => {
  if (routeFromHash()) render();
});
window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

updateNetworkStatus();
render();
registerServiceWorker();
