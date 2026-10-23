/* Service worker registration, update handling, and install prompt capture. */

import { showToast } from './ui.js';

let registration = null;
let deferredInstallPrompt = null;
const installListeners = new Set();

function notifyInstallListeners() {
  for (const listener of installListeners) {
    try {
      listener();
    } catch (error) {
      console.error('Install listener failed', error);
    }
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's mini-infobar out of the way and offer our own button.
    event.preventDefault();
    deferredInstallPrompt = event;
    notifyInstallListeners();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    notifyInstallListeners();
  });
}

export function canInstall() {
  return Boolean(deferredInstallPrompt);
}

export function onInstallAvailabilityChange(listener) {
  installListeners.add(listener);
  return () => installListeners.delete(listener);
}

/** Shows the browser install prompt once. Returns the user's choice. */
export async function promptInstall() {
  const prompt = deferredInstallPrompt;
  if (!prompt) return { outcome: 'unavailable' };

  deferredInstallPrompt = null;
  notifyInstallListeners();

  try {
    prompt.prompt();
    const choice = await prompt.userChoice;
    return choice || { outcome: 'dismissed' };
  } finally {
    notifyInstallListeners();
  }
}

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
