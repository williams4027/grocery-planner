/* App shell: boot, routing, tab state, network status. */

import { APP_NAME } from './config.js';
import * as store from './store.js';
import { initPwa } from './pwa.js';
import { mount as mountPlan } from './views/plan.js';
import { mount as mountList } from './views/list.js';
import { mount as mountRecipes } from './views/recipes.js';
import { mount as mountMore } from './views/more.js';

const routes = {
  plan: { title: 'Plan', mount: mountPlan },
  list: { title: 'List', mount: mountList },
  recipes: { title: 'Recipes', mount: mountRecipes },
  more: { title: 'More', mount: mountMore },
};

let activeRoute = 'plan';
let cleanup = null;
let started = false;

function routeFromHash() {
  if (!location.hash.startsWith('#/')) return null;

  const name = location.hash.replace(/^#\//, '').split('?')[0].split('/')[0];
  return Object.prototype.hasOwnProperty.call(routes, name) ? name : null;
}

function render() {
  if (!started) return;

  const key = routeFromHash() || activeRoute;
  activeRoute = key;
  const route = routes[key];
  const view = document.getElementById('view');

  if (cleanup) {
    try {
      cleanup();
    } catch (error) {
      console.error('View cleanup failed', error);
    }
    cleanup = null;
  }

  view.replaceChildren();

  try {
    cleanup = route.mount(view) || null;
  } catch (error) {
    console.error('View failed to mount', error);
    view.innerHTML = `
      <div class="card empty">
        <h2>Something went wrong</h2>
        <p>Reload the app to try again. Your saved list has not been touched.</p>
      </div>`;
  }

  document.title = `${route.title} · ${APP_NAME}`;
  updateTabs(key);
  window.scrollTo({ top: 0 });
}

function updateTabs(activeKey) {
  document.querySelectorAll('.tabbar a').forEach((link) => {
    if (link.dataset.route === activeKey) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function updateNetworkStatus() {
  const element = document.getElementById('net-status');
  if (!element) return;

  const offline = !navigator.onLine;
  element.hidden = !offline;
  element.textContent = offline ? 'Offline' : '';
}

async function boot() {
  const view = document.getElementById('view');
  view.innerHTML = '<div class="loading" role="status">Loading your list…</div>';

  try {
    await store.init();
  } catch (error) {
    console.error('Storage initialization failed', error);
  }

  started = true;
  render();
  initPwa();
}

window.addEventListener('hashchange', () => {
  if (started && routeFromHash()) render();
});

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);

updateNetworkStatus();
boot();
