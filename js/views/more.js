/* More — build info, backup/restore, install help, roadmap. */

import { VERSION } from '../config.js';
import * as store from '../store.js';
import {
  canInstall,
  checkForUpdates,
  onInstallAvailabilityChange,
  promptInstall,
} from '../pwa.js';
import { createSheetController } from '../sheet.js';
import {
  createHousehold,
  disconnectLocal,
  getSharingCode,
  getStatus as getSyncStatus,
  inspectCode,
  isConfigured as isSyncConfigured,
  isPaired as isSyncPaired,
  joinHousehold,
  subscribeStatus,
  syncNow,
} from '../sync.js';
import { ICONS, showToast } from '../ui.js';

const MODE_LABELS = {
  indexeddb: 'IndexedDB (this device)',
  localstorage: 'Local storage (this device)',
  memory: 'Not saved',
};

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function summaryLabel(summary) {
  return [
    countLabel(summary.lists, 'list'),
    countLabel(summary.items, 'item'),
    countLabel(summary.recipes, 'recipe'),
    countLabel(summary.plan, 'planned meal'),
  ].join(' · ');
}

function formatBackupDate(value) {
  if (!value) return 'Never';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Never';

  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(date);
  } catch (error) {
    return date.toLocaleString();
  }
}

function syncStatusLabel(status) {
  switch (status.state) {
    case 'not-configured':
      return 'Not configured';
    case 'unpaired':
      return 'Not connected';
    case 'idle':
      return 'Connected';
    case 'syncing':
      return 'Syncing…';
    case 'synced':
      return 'Synced';
    case 'offline':
      return 'Offline — saved here';
    case 'error':
      return status.lastError || 'Sync error';
    default:
      return status.state;
  }
}

const DRIVE_SEARCH_URL =
  'https://drive.google.com/drive/search?q=grocery-planner-backup';

export function mount(root) {
  let active = true;
  let restoreSheet = null;
  let resetSheet = null;
  let createSheet = null;
  let codeSheet = null;
  let joinSheet = null;
  let pendingImport = null;
  let pendingJoin = null;
  let unsubInstall = null;
  let unsubSync = null;

  function render() {
    if (restoreSheet) {
      restoreSheet.destroy();
      restoreSheet = null;
    }
    if (resetSheet) {
      resetSheet.destroy();
      resetSheet = null;
    }
    if (createSheet) {
      createSheet.destroy();
      createSheet = null;
    }
    if (codeSheet) {
      codeSheet.destroy();
      codeSheet = null;
    }
    if (joinSheet) {
      joinSheet.destroy();
      joinSheet = null;
    }
    if (unsubInstall) {
      unsubInstall();
      unsubInstall = null;
    }
    if (unsubSync) {
      unsubSync();
      unsubSync = null;
    }

    const info = store.getStorageInfo();
    const summary = store.getDataSummary();
    const settings = store.getState().settings;
    const lastExportAt = settings.lastExportAt;
    const wakeLockSupported = 'wakeLock' in navigator;
    const syncConfigured = isSyncConfigured();
    const syncPaired = isSyncPaired();
    const syncStatus = getSyncStatus();

    root.innerHTML = `
      <h1 class="page-title">More</h1>
      <p class="lede">Build info, backups, and where your data lives.</p>

      <section class="card" aria-labelledby="build-title">
        <div class="card__head">
          <h2 id="build-title">This build</h2>
          <span class="badge">Local-first</span>
        </div>
        <ul class="rows">
          <li><span class="row__label">Version</span><span class="row__value">${VERSION}</span></li>
          <li><span class="row__label">Lists</span><span class="row__value">${summary.lists}</span></li>
          <li><span class="row__label">Items</span><span class="row__value">${summary.items}</span></li>
          <li><span class="row__label">Recipes</span><span class="row__value">${summary.recipes}</span></li>
          <li><span class="row__label">Planned meals</span><span class="row__value">${summary.plan}</span></li>
          <li><span class="row__label">Storage</span><span class="row__value">${MODE_LABELS[info.mode] || info.mode}</span></li>
        </ul>
        <div class="btn-row">
          <button class="btn" id="check-updates" type="button">Check for updates</button>
        </div>
        <p class="card__note">
          Local-first: no Grocery Planner account, and data stays on this device unless you export it
          or turn on encrypted sharing. Search Google Drive opens Drive in a new tab; the app does
          not connect to your Google account.
        </p>
      </section>

      ${
        info.error
          ? `<div class="banner" role="status">${info.error}</div>`
          : ''
      }

      <section class="card" aria-labelledby="backup-title">
        <div class="card__head">
          <h2 id="backup-title">Backup &amp; restore</h2>
          <span class="badge">JSON</span>
        </div>
        <ul class="rows">
          <li>
            <span class="row__label">Last backup</span>
            <span class="row__value" id="last-backup">${formatBackupDate(lastExportAt)}</span>
          </li>
          <li>
            <span class="row__label">Contents</span>
            <span class="row__value">${summaryLabel(summary)}</span>
          </li>
        </ul>
        <div class="btn-row backup-buttons">
          <button class="btn btn--primary" id="export-btn" type="button">Export backup</button>
          <button class="btn" id="share-backup" type="button" hidden>Share backup</button>
          <button class="btn" id="restore-btn" type="button">Restore from file</button>
          <a
            class="btn"
            id="drive-link"
            href="${DRIVE_SEARCH_URL}"
            target="_blank"
            rel="noopener noreferrer"
          >Search Google Drive</a>
        </div>
        <input
          id="restore-file"
          class="sr-only"
          type="file"
          accept=".json,application/json"
          aria-label="Choose a backup file"
          tabindex="-1"
        />
        <p id="backup-status" class="sheet__status" role="status" aria-live="polite"></p>
        <p class="card__note">
          Downloads an unencrypted JSON file with every list, item, recipe, planned meal, and
          setting. Restoring replaces all data on this device. For two phones, keep the newest
          backup in a shared Google Drive folder, then restore that file on the other phone. Search
          Google Drive opens a prefilled Drive search; download a backup there, then use Restore
          from file.
        </p>
      </section>

      <section class="card" aria-labelledby="sharing-title">
        <div class="card__head">
          <h2 id="sharing-title">Share with partner</h2>
          <span class="badge">${syncPaired ? 'Encrypted' : 'Optional'}</span>
        </div>
        <ul class="rows">
          <li>
            <span class="row__label">Status</span>
            <span class="row__value" id="sharing-state">${syncStatusLabel(syncStatus)}</span>
          </li>
          <li>
            <span class="row__label">Last synced</span>
            <span class="row__value" id="sharing-last">${formatBackupDate(
              syncStatus.lastSyncedAt
            )}</span>
          </li>
        </ul>
        <p id="sharing-message" class="sheet__status" role="status" aria-live="polite">${
          syncStatus.state === 'error' ? syncStatus.lastError : ''
        }</p>
        ${
          !syncConfigured
            ? `<p class="card__note">
                Encrypted sync is not configured in this build. Deploy the Cloudflare Worker and
                set <code>SYNC_URL</code> in <code>js/config.js</code>. See
                <code>worker/README.md</code>.
              </p>`
            : syncPaired
              ? `<div class="btn-row">
                  <button class="btn btn--primary" id="sync-now" type="button">Sync now</button>
                  <button class="btn" id="show-share-code" type="button">Show sharing code</button>
                </div>
                <p class="card__note">
                  Changes sync automatically while both apps are open. The sharing code is also the
                  encryption key; keep it private.
                </p>`
              : `<div class="btn-row">
                  <button class="btn btn--primary" id="share-create" type="button">Set up sharing</button>
                  <button class="btn" id="share-join" type="button">Join with code</button>
                </div>
                <p class="card__note">
                  Set up on one phone, then paste its code into the other phone&rsquo;s app. Joining
                  replaces the second phone&rsquo;s local data after confirmation.
                </p>`
        }
      </section>

      <section class="card" aria-labelledby="reset-card-title">
        <div class="card__head">
          <h2 id="reset-card-title">Factory reset</h2>
          <span class="badge">Destructive</span>
        </div>
        <p class="card__note" style="margin-top: 0">
          Clears every list, item, recipe, planned meal, and setting on this device, then restores
          a fresh Groceries list and the original seeded recipes. Export a backup first if you may
          need this data.
        </p>
        <div class="btn-row">
          <button class="btn btn--danger reset-btn" id="reset-btn" type="button">
            Reset to seeded data
          </button>
        </div>
      </section>

      <section class="card" aria-labelledby="install-title">
        <div class="card__head">
          <h2 id="install-title">Install on your phone</h2>
        </div>
        <p class="card__note" style="margin-top: 0">
          Installing protects your data: Safari can clear storage for sites you have not used in a
          while, but keeps installed apps.
        </p>
        <div class="btn-row" id="install-actions" hidden>
          <button class="btn btn--primary" id="install-app" type="button" hidden>
            Install app
          </button>
        </div>
        <p id="install-status" class="sheet__status" role="status" aria-live="polite"></p>
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

      <section class="card" aria-labelledby="shopping-title">
        <div class="card__head">
          <h2 id="shopping-title">Shopping screen</h2>
          <span class="badge">Optional</span>
        </div>
        <label class="check-row" for="keep-awake">
          <input
            id="keep-awake"
            class="check-row__input"
            type="checkbox"
            ${settings.keepAwake ? 'checked' : ''}
            ${wakeLockSupported ? '' : 'disabled'}
          />
          <span class="check-row__text">
            <strong>Keep the screen awake in List</strong>
            <span>
              ${
                wakeLockSupported
                  ? 'Best effort while this tab is visible. Your phone can still dim for battery saver.'
                  : 'This browser does not support the Screen Wake Lock API.'
              }
            </span>
          </span>
        </label>
      </section>

      <section class="card" aria-labelledby="roadmap-title">
        <div class="card__head">
          <h2 id="roadmap-title">What&rsquo;s next</h2>
        </div>
        <ul class="roadmap">
          <li class="is-done"><span class="roadmap__dot"></span>Phase 0 — installable shell</li>
          <li class="is-done"><span class="roadmap__dot"></span>Phase 1 — grocery list that persists</li>
          <li class="is-done"><span class="roadmap__dot"></span>Per-store lists and Google Calendar trips</li>
          <li class="is-done"><span class="roadmap__dot"></span>Recipes, editing, and seeded meals</li>
          <li class="is-done"><span class="roadmap__dot"></span>Backup and restore</li>
          <li class="is-done"><span class="roadmap__dot"></span>Meal plan with automatic list additions</li>
          <li class="is-done"><span class="roadmap__dot"></span>Shopping polish and list management</li>
          <li class="is-done"><span class="roadmap__dot"></span>Bulk move, delete, and clear-list actions</li>
          <li class="is-done"><span class="roadmap__dot"></span>Install prompt and backup sharing</li>
          <li class="is-done"><span class="roadmap__dot"></span>Keep-awake shopping option</li>
          <li class="is-done"><span class="roadmap__dot"></span>Alphabetical sorting within aisles</li>
          <li class="is-done"><span class="roadmap__dot"></span>Recipe ordering, duplication, and .ics export</li>
          <li class="is-done"><span class="roadmap__dot"></span>Shared Drive backup handoff</li>
          <li class="is-done"><span class="roadmap__dot"></span>Manual aisle overrides and per-list aisle order</li>
          <li class="is-done"><span class="roadmap__dot"></span>Google Drive backup search shortcut</li>
          <li class="is-done"><span class="roadmap__dot"></span>Factory reset to seeded data</li>
          <li class="is-done"><span class="roadmap__dot"></span>Encrypted phone-to-phone sync</li>
          <li class="is-current"><span class="roadmap__dot"></span>Optional — buy-again suggestions</li>
        </ul>
      </section>

      <dialog id="restore-dialog" class="sheet" aria-labelledby="restore-title">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__head">
          <h2 id="restore-title">Replace all data?</h2>
          <button class="sheet__close" id="restore-close" type="button" aria-label="Close">
            ${ICONS.close}
          </button>
        </div>
        <p class="restore-warning">
          This replaces every list, item, recipe, planned meal, and setting on this device with the
          backup. This cannot be undone. If sharing is on, it will be turned off before restoring.
        </p>
        <p id="restore-summary" class="backup-summary"></p>
        <p id="restore-meta" class="card__note"></p>
        <p id="restore-status" class="sheet__status" role="status" aria-live="polite"></p>
        <div class="btn-row backup-actions">
          <button class="btn" id="restore-cancel" type="button">Cancel</button>
          <button class="btn btn--danger" id="restore-confirm" type="button">
            Replace everything
          </button>
        </div>
      </dialog>

      <dialog id="reset-dialog" class="sheet" aria-labelledby="reset-dialog-title">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__head">
          <h2 id="reset-dialog-title">Reset everything?</h2>
          <button class="sheet__close" id="reset-close" type="button" aria-label="Close">
            ${ICONS.close}
          </button>
        </div>
        <p class="restore-warning">
          This deletes every list, item, recipe, planned meal, and setting on this device. Then it
          restores a fresh Groceries list and the original seeded recipes. This cannot be undone. If
          sharing is on, it will be turned off first.
        </p>
        <p class="backup-summary">
          Export a backup first if you may need your current data.
        </p>
        <p id="reset-dialog-status" class="sheet__status" role="status" aria-live="polite"></p>
        <div class="btn-row backup-actions">
          <button class="btn" id="reset-cancel" type="button">Cancel</button>
          <button class="btn btn--danger" id="reset-confirm" type="button">
            Reset everything
          </button>
        </div>
      </dialog>

      <dialog id="share-create-dialog" class="sheet" aria-labelledby="share-create-title">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__head">
          <h2 id="share-create-title">Set up sharing?</h2>
          <button class="sheet__close" id="share-create-close" type="button" aria-label="Close">
            ${ICONS.close}
          </button>
        </div>
        <p class="restore-warning">
          This phone&rsquo;s current lists, recipes, and meal plan will be shared with one other
          person. The sharing code is also the encryption key, so treat it like a password.
        </p>
        <p id="share-create-status" class="sheet__status" role="status" aria-live="polite"></p>
        <div class="btn-row backup-actions">
          <button class="btn" id="share-create-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="share-create-confirm" type="button">
            Create sharing code
          </button>
        </div>
      </dialog>

      <dialog id="share-code-dialog" class="sheet" aria-labelledby="share-code-title">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__head">
          <h2 id="share-code-title">Your sharing code</h2>
          <button class="sheet__close" id="share-code-close" type="button" aria-label="Close">
            ${ICONS.close}
          </button>
        </div>
        <p class="card__note" style="margin-top: 0">
          On the other phone, open Grocery Planner &rarr; More &rarr; Join with code, then paste
          this code. Keep it private; it is the key to the shared data.
        </p>
        <textarea
          id="share-code-value"
          class="share-code"
          rows="3"
          readonly
          spellcheck="false"
        ></textarea>
        <p id="share-code-status" class="sheet__status" role="status" aria-live="polite"></p>
        <div class="btn-row backup-actions">
          <button class="btn btn--primary" id="share-code-copy" type="button">Copy code</button>
          <button class="btn" id="share-code-send" type="button" hidden>Share code</button>
        </div>
      </dialog>

      <dialog id="share-join-dialog" class="sheet" aria-labelledby="share-join-title">
        <div class="sheet__handle" aria-hidden="true"></div>
        <div class="sheet__head">
          <h2 id="share-join-title">Join a shared plan</h2>
          <button class="sheet__close" id="share-join-close" type="button" aria-label="Close">
            ${ICONS.close}
          </button>
        </div>
        <p class="restore-warning">
          This replaces every list, item, recipe, planned meal, and setting on this phone with the
          other phone&rsquo;s encrypted data. Export a backup first if you may need the current
          data.
        </p>
        <label class="field field--stacked">
          <span class="field__label">Sharing code</span>
          <textarea
            id="share-join-input"
            class="share-code"
            rows="3"
            autocomplete="off"
            autocapitalize="off"
            spellcheck="false"
            placeholder="gp1.…"
          ></textarea>
        </label>
        <p id="share-join-status" class="sheet__status" role="status" aria-live="polite"></p>
        <div id="share-join-preview" hidden>
          <p id="share-join-summary" class="backup-summary"></p>
          <div class="btn-row backup-actions">
            <button class="btn btn--danger" id="share-join-confirm" type="button">
              Replace everything and join
            </button>
          </div>
        </div>
        <div class="btn-row backup-actions">
          <button class="btn" id="share-join-cancel" type="button">Cancel</button>
          <button class="btn btn--primary" id="share-join-check" type="button">Check code</button>
        </div>
      </dialog>
    `;

    bind();
  }

  function showSharingCode(code) {
    const value = root.querySelector('#share-code-value');
    if (!value) return;

    if (!code) {
      showToast('Sharing is not set up on this phone.');
      return;
    }

    value.value = code;
    const status = root.querySelector('#share-code-status');
    const sendButton = root.querySelector('#share-code-send');
    if (status) status.textContent = '';
    if (sendButton) sendButton.hidden = typeof navigator.share !== 'function';
    if (codeSheet) codeSheet.open();
  }

  function bind() {
    const updatesButton = root.querySelector('#check-updates');
    const exportButton = root.querySelector('#export-btn');
    const shareButton = root.querySelector('#share-backup');
    const restoreButton = root.querySelector('#restore-btn');
    const driveLink = root.querySelector('#drive-link');
    const fileInput = root.querySelector('#restore-file');
    const status = root.querySelector('#backup-status');
    const restoreDialog = root.querySelector('#restore-dialog');
    const restoreStatus = root.querySelector('#restore-status');
    const resetButton = root.querySelector('#reset-btn');
    const resetDialog = root.querySelector('#reset-dialog');
    const resetDialogStatus = root.querySelector('#reset-dialog-status');
    const installActions = root.querySelector('#install-actions');
    const installButton = root.querySelector('#install-app');
    const installStatus = root.querySelector('#install-status');
    const lastBackupValue = root.querySelector('#last-backup');

    function markExported(exportedAt) {
      store.recordExport(exportedAt);
      if (lastBackupValue) lastBackupValue.textContent = formatBackupDate(exportedAt);
    }

    if (updatesButton) updatesButton.addEventListener('click', checkForUpdates);

    const keepAwake = root.querySelector('#keep-awake');
    if (keepAwake) {
      keepAwake.addEventListener('change', () => {
        store.setKeepAwake(keepAwake.checked);
        showToast(
          keepAwake.checked
            ? 'Screen will stay awake in List.'
            : 'List can let the screen sleep.'
        );
      });
    }

    if (installButton) {
      const syncInstallButton = () => {
        const available = canInstall();
        installActions.hidden = !available;
        installButton.hidden = !available;
        installButton.disabled = false;
      };

      syncInstallButton();
      unsubInstall = onInstallAvailabilityChange(syncInstallButton);

      installButton.addEventListener('click', async () => {
        installStatus.textContent = '';
        installButton.disabled = true;

        try {
          const choice = await promptInstall();
          if (choice.outcome === 'accepted') {
            installStatus.textContent = 'Install accepted. Launch Grocery Planner from your Home Screen.';
            showToast('Installing Grocery Planner…');
          } else if (choice.outcome === 'dismissed') {
            installStatus.textContent =
              'Install dismissed. You can install later from your browser menu.';
          } else {
            installStatus.textContent =
              'Use your browser menu to install this app on your device.';
          }
        } catch (error) {
          console.error('Install prompt failed', error);
          installStatus.textContent = 'Could not open the install prompt. Use your browser menu.';
        } finally {
          syncInstallButton();
        }
      });
    }

    const syncNowButton = root.querySelector('#sync-now');
    const showShareCodeButton = root.querySelector('#show-share-code');
    const shareCreateButton = root.querySelector('#share-create');
    const shareJoinButton = root.querySelector('#share-join');
    const shareCreateDialog = root.querySelector('#share-create-dialog');
    const shareCodeDialog = root.querySelector('#share-code-dialog');
    const shareJoinDialog = root.querySelector('#share-join-dialog');
    const shareCreateStatus = root.querySelector('#share-create-status');
    const shareCodeStatus = root.querySelector('#share-code-status');
    const shareJoinStatus = root.querySelector('#share-join-status');
    const shareJoinInput = root.querySelector('#share-join-input');
    const shareJoinPreview = root.querySelector('#share-join-preview');
    const shareJoinSummary = root.querySelector('#share-join-summary');
    const shareCodeValue = root.querySelector('#share-code-value');

    if (shareCreateDialog) {
      createSheet = createSheetController(shareCreateDialog, {
        trigger: shareCreateButton,
        initialFocus: () => root.querySelector('#share-create-cancel'),
        onClose: () => {
          shareCreateStatus.textContent = '';
        },
      });
    }

    if (shareCodeDialog) {
      codeSheet = createSheetController(shareCodeDialog, {
        trigger: showShareCodeButton,
        initialFocus: () => shareCodeValue,
        selectOnOpen: true,
        onClose: () => {
          shareCodeStatus.textContent = '';
        },
      });
    }

    if (shareJoinDialog) {
      joinSheet = createSheetController(shareJoinDialog, {
        trigger: shareJoinButton,
        initialFocus: () => shareJoinInput,
        onClose: () => {
          pendingJoin = null;
          shareJoinStatus.textContent = '';
          shareJoinPreview.hidden = true;
        },
      });
    }

    if (shareCreateButton) {
      shareCreateButton.addEventListener('click', () => {
        shareCreateStatus.textContent = '';
        createSheet.open();
      });
    }

    if (showShareCodeButton) {
      showShareCodeButton.addEventListener('click', () => {
        showSharingCode(getSharingCode());
      });
    }

    if (syncNowButton) {
      syncNowButton.addEventListener('click', async () => {
        syncNowButton.disabled = true;
        try {
          const result = await syncNow();
          if (result.ok) {
            showToast(result.changed ? 'Synced with partner.' : 'Already up to date.');
          }
        } finally {
          syncNowButton.disabled = false;
        }
      });
    }

    if (shareJoinButton) {
      shareJoinButton.addEventListener('click', () => {
        pendingJoin = null;
        shareJoinInput.value = '';
        shareJoinStatus.textContent = '';
        shareJoinPreview.hidden = true;
        joinSheet.open();
      });
    }

    if (root.querySelector('#share-create-close')) {
      root
        .querySelector('#share-create-close')
        .addEventListener('click', () => createSheet.close());
      root
        .querySelector('#share-create-cancel')
        .addEventListener('click', () => createSheet.close());
    }

    if (root.querySelector('#share-code-close')) {
      root
        .querySelector('#share-code-close')
        .addEventListener('click', () => codeSheet.close());
    }

    if (root.querySelector('#share-join-close')) {
      root
        .querySelector('#share-join-close')
        .addEventListener('click', () => joinSheet.close());
      root
        .querySelector('#share-join-cancel')
        .addEventListener('click', () => joinSheet.close());
    }

    if (shareCreateDialog) {
      root
        .querySelector('#share-create-confirm')
        .addEventListener('click', async () => {
          const button = root.querySelector('#share-create-confirm');
          button.disabled = true;
          shareCreateStatus.textContent = 'Creating sharing code…';

          try {
            const code = await createHousehold();
            createSheet.close();
            render();
            showSharingCode(code);
            showToast('Sharing is on. Code ready to send.');
          } catch (error) {
            console.error('Create sharing failed', error);
            shareCreateStatus.textContent =
              error.message || 'Could not create a sharing code.';
            button.disabled = false;
          }
        });
    }

    if (shareCodeDialog) {
      const sendButton = root.querySelector('#share-code-send');
      if (sendButton) {
        sendButton.hidden = typeof navigator.share !== 'function';
        sendButton.addEventListener('click', async () => {
          try {
            await navigator.share({
              title: 'Grocery Planner sharing code',
              text: shareCodeValue.value,
            });
          } catch (error) {
            if (error && error.name === 'AbortError') return;
            shareCodeStatus.textContent = 'Could not share the code. Copy it instead.';
          }
        });
      }

      root.querySelector('#share-code-copy').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(shareCodeValue.value);
          shareCodeStatus.textContent = 'Code copied.';
          showToast('Sharing code copied.');
        } catch (error) {
          shareCodeValue.focus();
          shareCodeValue.select();
          try {
            document.execCommand('copy');
            shareCodeStatus.textContent = 'Code copied.';
          } catch (copyError) {
            shareCodeStatus.textContent = 'Select the code and copy it manually.';
          }
        }
      });
    }

    if (shareJoinDialog) {
      root.querySelector('#share-join-check').addEventListener('click', async () => {
        const button = root.querySelector('#share-join-check');
        const code = shareJoinInput.value.trim();
        if (!code) {
          shareJoinStatus.textContent = 'Paste the sharing code first.';
          return;
        }

        button.disabled = true;
        shareJoinStatus.textContent = 'Checking the code…';
        try {
          const inspected = await inspectCode(code);
          pendingJoin = { code };
          shareJoinSummary.textContent = `This shared plan contains ${summaryLabel(
            inspected.summary
          )}. Joining will replace everything on this phone.`;
          shareJoinPreview.hidden = false;
          shareJoinStatus.textContent = '';
        } catch (error) {
          console.error('Sharing code check failed', error);
          pendingJoin = null;
          shareJoinPreview.hidden = true;
          shareJoinStatus.textContent =
            error.message || 'Could not read that sharing code.';
        } finally {
          button.disabled = false;
        }
      });

      root.querySelector('#share-join-confirm').addEventListener('click', async () => {
        if (!pendingJoin) return;

        const button = root.querySelector('#share-join-confirm');
        button.disabled = true;
        shareJoinStatus.textContent = 'Joining and replacing this phone…';

        try {
          const result = await joinHousehold(pendingJoin.code);
          joinSheet.close();
          render();
          showToast(`Joined shared plan: ${summaryLabel(result.summary)}.`);
        } catch (error) {
          console.error('Join sharing failed', error);
          shareJoinStatus.textContent = error.message || 'Could not join that shared plan.';
          button.disabled = false;
        }
      });
    }

    unsubSync = subscribeStatus((next) => {
      if (!active) return;

      const stateElement = root.querySelector('#sharing-state');
      const lastElement = root.querySelector('#sharing-last');
      const message = root.querySelector('#sharing-message');

      if (stateElement) stateElement.textContent = syncStatusLabel(next);
      if (lastElement) lastElement.textContent = formatBackupDate(next.lastSyncedAt);
      if (message) {
        message.textContent = next.state === 'error' ? next.lastError : '';
      }
    });

    restoreSheet = createSheetController(restoreDialog, {
      trigger: () => root.querySelector('#restore-btn'),
      initialFocus: () => root.querySelector('#restore-cancel'),
      onClose: () => {
        pendingImport = null;
      },
    });

    resetSheet = createSheetController(resetDialog, {
      trigger: resetButton,
      initialFocus: () => root.querySelector('#reset-cancel'),
      onClose: () => {
        resetDialogStatus.textContent = '';
      },
    });

    exportButton.addEventListener('click', () => {
      status.textContent = '';

      try {
        const backup = store.createBackup();
        const payload = JSON.stringify(backup, null, 2);
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');

        link.href = url;
        link.download = `grocery-planner-backup-${backup.exportedAt.slice(0, 10)}.json`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);

        markExported(backup.exportedAt);
        status.textContent = `Backup downloaded: ${summaryLabel(store.getDataSummary())}.`;
        showToast('Backup downloaded.');
      } catch (error) {
        console.error('Backup export failed', error);
        status.textContent = 'Could not create the backup file.';
        showToast('Could not create the backup.');
      }
    });

    const canShareFiles =
      typeof navigator.share === 'function' &&
      typeof File === 'function' &&
      (typeof navigator.canShare !== 'function' ||
        (() => {
          try {
            return navigator.canShare({
              files: [
                new File(['{}'], 'backup.json', { type: 'application/json' }),
              ],
            });
          } catch (error) {
            return false;
          }
        })());
    const canCopyBackup = Boolean(
      navigator.clipboard && typeof navigator.clipboard.writeText === 'function'
    );
    const shareMode = canShareFiles ? 'share' : canCopyBackup ? 'copy' : null;

    if (shareButton) {
      shareButton.hidden = !shareMode;
      if (shareMode === 'copy') shareButton.textContent = 'Copy backup';

      shareButton.addEventListener('click', async () => {
        status.textContent = '';

        try {
          const backup = store.createBackup();
          const payload = JSON.stringify(backup, null, 2);

          if (shareMode === 'share') {
            const file = new File(
              [payload],
              `grocery-planner-backup-${backup.exportedAt.slice(0, 10)}.json`,
              { type: 'application/json' }
            );

            if (navigator.canShare && !navigator.canShare({ files: [file] })) {
              status.textContent = 'Sharing files is not available in this browser.';
              return;
            }

            await navigator.share({
              files: [file],
              title: 'Grocery Planner backup',
              text: 'Backup of my grocery lists and meal plan.',
            });
            markExported(backup.exportedAt);
            status.textContent = `Backup shared: ${summaryLabel(store.getDataSummary())}.`;
            showToast('Backup shared.');
            return;
          }

          await navigator.clipboard.writeText(payload);
          markExported(backup.exportedAt);
          status.textContent = `Backup copied: ${summaryLabel(store.getDataSummary())}.`;
          showToast('Backup copied to the clipboard.');
        } catch (error) {
          if (error && error.name === 'AbortError') return;
          console.error('Backup share failed', error);
          status.textContent = 'Could not share the backup. Try Export backup instead.';
          showToast('Could not share the backup.');
        }
      });
    }

    restoreButton.addEventListener('click', () => fileInput.click());

    if (driveLink) {
      driveLink.addEventListener('click', () => {
        status.textContent =
          'Google Drive opened in a new tab. Download the backup you want, then tap Restore from file.';
        showToast('Download the backup, then restore the file.');
      });
    }

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;

      status.textContent = '';

      try {
        if (file.size > 25 * 1024 * 1024) {
          throw new Error('That backup is too large to import.');
        }

        const text = await file.text();
        if (!active) return;

        const info = store.inspectBackup(text);
        pendingImport = { text, name: file.name };

        root.querySelector('#restore-summary').textContent =
          `This backup contains ${countLabel(info.summary.lists, 'list')}, ` +
          `${countLabel(info.summary.items, 'item')}, ` +
          `${countLabel(info.summary.recipes, 'recipe')}, and ` +
          `${countLabel(info.summary.plan, 'planned meal')}.`;
        root.querySelector('#restore-meta').textContent = info.exportedAt
          ? `Backup from ${formatBackupDate(info.exportedAt)}${
              info.appVersion ? ` · version ${info.appVersion}` : ''
            }`
          : `File: ${file.name}`;
        restoreStatus.textContent = '';
        restoreSheet.open();
      } catch (error) {
        pendingImport = null;
        status.textContent = error.message || 'Could not read that backup.';
        showToast('Could not read that backup.');
      }
    });

    root.querySelector('#restore-close').addEventListener('click', () => restoreSheet.close());
    root.querySelector('#restore-cancel').addEventListener('click', () => restoreSheet.close());

    root.querySelector('#restore-confirm').addEventListener('click', async () => {
      if (!pendingImport) return;

      const text = pendingImport.text;
      const confirmButton = root.querySelector('#restore-confirm');
      confirmButton.disabled = true;
      restoreStatus.textContent = isSyncPaired()
        ? 'Turning off sharing, then restoring…'
        : 'Restoring…';

      try {
        if (isSyncPaired()) await disconnectLocal();
        const result = store.importBackup(text);
        restoreSheet.close();
        render();
        showToast(`Backup restored: ${summaryLabel(result.summary)}. Sharing is off.`);
      } catch (error) {
        console.error('Backup restore failed', error);
        restoreStatus.textContent = error.message || 'Could not restore that backup.';
        confirmButton.disabled = false;
      }
    });

    resetButton.addEventListener('click', () => {
      resetDialogStatus.textContent = '';
      resetSheet.open();
    });

    root.querySelector('#reset-close').addEventListener('click', () => resetSheet.close());
    root.querySelector('#reset-cancel').addEventListener('click', () => resetSheet.close());

    root.querySelector('#reset-confirm').addEventListener('click', async () => {
      const confirmButton = root.querySelector('#reset-confirm');
      confirmButton.disabled = true;
      resetDialogStatus.textContent = 'Resetting…';

      try {
        if (isSyncPaired()) await disconnectLocal();
        await store.resetToSeedData();
        const storage = store.getStorageInfo();
        resetSheet.close();
        render();
        showToast(
          storage.error
            ? 'Data reset in this tab, but it could not be saved.'
            : 'App reset. Seeded recipes restored. Sharing is off.'
        );
      } catch (error) {
        console.error('Factory reset failed', error);
        resetDialogStatus.textContent = error.message || 'Could not reset the app.';
        confirmButton.disabled = false;
      }
    });
  }

  render();

  return () => {
    active = false;
    if (unsubInstall) {
      unsubInstall();
      unsubInstall = null;
    }
    if (unsubSync) {
      unsubSync();
      unsubSync = null;
    }
    if (restoreSheet) {
      restoreSheet.destroy();
      restoreSheet = null;
    }
    if (resetSheet) {
      resetSheet.destroy();
      resetSheet = null;
    }
    if (createSheet) {
      createSheet.destroy();
      createSheet = null;
    }
    if (codeSheet) {
      codeSheet.destroy();
      codeSheet = null;
    }
    if (joinSheet) {
      joinSheet.destroy();
      joinSheet = null;
    }
  };
}
