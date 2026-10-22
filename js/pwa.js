/* Service worker registration and update handling. */

import { showToast } from './ui.js';

let registration = null;

export function initPwa() {
  if (!('serviceWorker' in navigator)) return;

  if (location.protocol === 'file:') {
    console.warn('Service worker skipped: open the app over http(s), not file://.');
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
    .then((value) => {
      registration = value;
    })
    .catch((error) => {
      console.error('Service worker registration failed', error);
    });
}

export async function checkForUpdates() {
  if (!registration) {
    showToast('Offline support is still starting up.');
    return;
  }

  try {
    await registration.update();
    showToast('You are up to date.');
  } catch (error) {
    console.error('Update check failed', error);
    showToast('Could not check for updates.');
  }
}
