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

export function mount(root) {
  let active = true;
  let restoreSheet = null;
  let pendingImport = null;
  let unsubInstall = null;

  function render() {
    if (restoreSheet) {
      restoreSheet.destroy();
      restoreSheet = null;
    }
    if (unsubInstall) {
      unsubInstall();
      unsubInstall = null;
    }

    const info = store.getStorageInfo();
    const summary = store.getDataSummary();
    const settings = store.getState().settings;
    const lastExportAt = settings.lastExportAt;
    const wakeLockSupported = 'wakeLock' in navigator;

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
          No accounts and no server. Nothing leaves this device unless you export or share it, or
          hand a trip to Google Calendar.
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
          backup in a shared Google Drive folder and restore that file on the other phone.
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
          <li class="is-current"><span class="roadmap__dot"></span>Optional — buy-again suggestions and encrypted export</li>
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
          backup. This cannot be undone.
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
    `;

    bind();
  }

  function bind() {
    const updatesButton = root.querySelector('#check-updates');
    const exportButton = root.querySelector('#export-btn');
    const shareButton = root.querySelector('#share-backup');
    const restoreButton = root.querySelector('#restore-btn');
    const fileInput = root.querySelector('#restore-file');
    const status = root.querySelector('#backup-status');
    const restoreDialog = root.querySelector('#restore-dialog');
    const restoreStatus = root.querySelector('#restore-status');
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

    restoreSheet = createSheetController(restoreDialog, {
      trigger: () => root.querySelector('#restore-btn'),
      initialFocus: () => root.querySelector('#restore-cancel'),
      onClose: () => {
        pendingImport = null;
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

    root.querySelector('#restore-confirm').addEventListener('click', () => {
      if (!pendingImport) return;

      const text = pendingImport.text;
      restoreStatus.textContent = '';

      try {
        const result = store.importBackup(text);
        restoreSheet.close();
        render();
        showToast(`Backup restored: ${summaryLabel(result.summary)}.`);
      } catch (error) {
        console.error('Backup restore failed', error);
        restoreStatus.textContent = error.message || 'Could not restore that backup.';
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
    if (restoreSheet) {
      restoreSheet.destroy();
      restoreSheet = null;
    }
  };
}
