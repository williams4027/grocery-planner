/* Grocery list view — per-store lists, aisle order, calendar handoff. */

import { STORE_PRESETS } from '../config.js';
import * as store from '../store.js';
import { buildGoogleCalendarUrl } from '../calendar.js';
import { createSheetController } from '../sheet.js';
import { h, icon, ICONS, showToast, formatQuantity } from '../ui.js';

const PRESET_ORDER = ['kroger', 'wholefoods', 'costco', 'custom'];

export function mount(root) {
  let renaming = false;
  let selectedPreset = 'custom';
  let lastActiveChipId = null;
  let editingItemId = null;
  let lastItemTrigger = null;
  let selecting = false;
  let selectionListId = null;
  const selectedItemIds = new Set();
  let wakeLock = null;
  let wakeLockPending = false;

  document.body.classList.add('has-add-dock');

  root.innerHTML = `
    <header class="page-head">
      <div class="page-head__text">
        <div id="name-slot"></div>
        <p class="list-count" id="list-count" aria-live="polite"></p>
      </div>
      <div class="page-head__actions">
        <button
          class="icon-btn"
          id="select-btn"
          type="button"
          aria-label="Select items"
          title="Select items"
          aria-pressed="false"
        >
          ${ICONS.move}
        </button>
        <button
          class="icon-btn"
          id="calendar-btn"
          type="button"
          aria-label="Add trip to Google Calendar"
          title="Google Calendar"
          aria-haspopup="dialog"
          aria-controls="calendar-dialog"
        >
          ${ICONS.calendar}
        </button>
        <button
          class="icon-btn"
          id="rename-btn"
          type="button"
          aria-label="Rename list"
          title="Rename list"
        >
          ${ICONS.pencil}
        </button>
      </div>
    </header>

    <div class="list-bar">
      <div id="list-chips" class="list-chips" role="group" aria-label="Store lists"></div>
      <button
        class="list-chip list-chip--new"
        id="new-list-chip"
        type="button"
        aria-label="New list"
        title="New list"
      >
        ${ICONS.plus}
      </button>
      <button
        class="list-chip list-chip--new list-chip--manage"
        id="manage-lists-chip"
        type="button"
        aria-label="Manage lists"
        title="Manage lists"
        aria-haspopup="dialog"
        aria-controls="manage-lists-dialog"
      >
        ${ICONS.ellipsis}
      </button>
    </div>

    <div id="storage-warning" class="banner" role="status" hidden></div>

    <section class="card list-card" aria-label="Grocery list">
      <div id="items" class="items" tabindex="-1" aria-label="List items"></div>
    </section>

    <div class="add-dock" id="add-dock">
      <button
        class="fab"
        id="add-fab"
        type="button"
        aria-haspopup="dialog"
        aria-controls="add-dialog"
      >
        <span class="fab__icon" aria-hidden="true">${ICONS.plus}</span>
        <span>Add item</span>
      </button>
    </div>

    <div class="bulk-dock" id="bulk-dock" hidden>
      <div class="bulk-dock__inner">
        <div class="bulk-dock__head">
          <p class="bulk-dock__count" id="bulk-count" aria-live="polite">Tap items to select</p>
          <div class="bulk-dock__links">
            <button class="bulk-link" id="bulk-select-all" type="button">Select all</button>
            <button class="bulk-link" id="bulk-cancel" type="button">Cancel</button>
          </div>
        </div>
        <div class="bulk-dock__actions">
          <button class="btn bulk-btn" id="bulk-move" type="button" aria-haspopup="dialog">
            ${ICONS.move}
            <span>Move<span class="bulk-btn__suffix"> to&hellip;</span></span>
          </button>
          <button class="btn bulk-btn" id="bulk-delete" type="button">Delete</button>
          <button class="btn bulk-btn bulk-btn--danger" id="bulk-clear" type="button">
            Clear list
          </button>
        </div>
      </div>
    </div>

    <dialog id="add-dialog" class="sheet" aria-labelledby="sheet-title">
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head">
        <h2 id="sheet-title">Add item</h2>
        <button class="sheet__close" id="sheet-close" type="button" aria-label="Close">
          ${ICONS.close}
        </button>
      </div>

      <form id="add-form" class="add" autocomplete="off">
        <div class="add__main">
          <label class="sr-only" for="add-name">Item name</label>
          <input
            id="add-name"
            class="add__name"
            name="name"
            type="text"
            placeholder="Add an item"
            enterkeyhint="done"
            autocapitalize="sentences"
            maxlength="120"
            autofocus
            required
          />
          <button id="add-submit" class="btn btn--primary add__submit" type="submit">Add</button>
        </div>
        <div class="add__details">
          <label class="field">
            <span class="field__label">Qty</span>
            <input
              id="add-qty"
              class="field__input field__input--qty"
              name="qty"
              type="number"
              inputmode="decimal"
              step="0.25"
              min="0"
              placeholder="2"
            />
          </label>
          <label class="field">
            <span class="field__label">Description</span>
            <input
              id="add-unit"
              class="field__input"
              name="unit"
              type="text"
              maxlength="40"
              placeholder="organic, green, 2 lb bag…"
            />
          </label>
        </div>
        <label class="field field--stacked" id="add-list-field" hidden>
          <span class="field__label" id="add-list-label">Add to</span>
          <select id="add-list" class="field__input" name="list"></select>
        </label>
      </form>

      <p id="sheet-status" class="sheet__status" role="status" aria-live="polite"></p>
    </dialog>

    <dialog id="new-list-dialog" class="sheet" aria-labelledby="new-list-title">
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head">
        <h2 id="new-list-title">New list</h2>
        <button class="sheet__close" id="new-list-close" type="button" aria-label="Close">
          ${ICONS.close}
        </button>
      </div>

      <form id="new-list-form" class="new-list" autocomplete="off" novalidate>
        <fieldset class="preset-field">
          <legend class="field__label">Store layout</legend>
          <div id="preset-chips" class="preset-chips"></div>
        </fieldset>

        <label class="field field--stacked">
          <span class="field__label">List name</span>
          <input
            id="new-list-name"
            class="add__name"
            name="name"
            type="text"
            maxlength="60"
            placeholder="e.g. Trader Joe&rsquo;s"
            enterkeyhint="done"
            autocapitalize="words"
          />
        </label>

        <button class="btn btn--primary new-list__submit" type="submit">Create list</button>
      </form>

      <p id="new-list-status" class="sheet__status" role="status" aria-live="polite"></p>
    </dialog>

    <dialog
      id="manage-lists-dialog"
      class="sheet manage-lists-sheet"
      aria-labelledby="manage-lists-title"
    >
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head">
        <h2 id="manage-lists-title">Manage lists</h2>
        <button class="sheet__close" id="manage-lists-close" type="button" aria-label="Close">
          ${ICONS.close}
        </button>
      </div>
      <p class="card__note manage-lists-intro">
        Duplicate a list for another trip, archive lists you are done with, or restore an archived
        list. Archiving keeps every item.
      </p>
      <div id="manage-lists-body"></div>
      <p id="manage-lists-status" class="sheet__status" role="status" aria-live="polite"></p>
    </dialog>

    <dialog id="move-dialog" class="sheet" aria-labelledby="move-title">
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head">
        <h2 id="move-title">Move items</h2>
        <button class="sheet__close" id="move-close" type="button" aria-label="Close">
          ${ICONS.close}
        </button>
      </div>

      <form id="move-form" class="move-form">
        <p id="move-summary" class="card__note move-summary"></p>
        <div id="move-options" class="move-options" role="radiogroup" aria-label="Target list"></div>
        <button class="btn btn--primary new-list__submit" id="move-submit" type="submit">
          Move items
        </button>
      </form>

      <p id="move-status" class="sheet__status" role="status" aria-live="polite"></p>
    </dialog>

    <dialog id="calendar-dialog" class="sheet" aria-labelledby="calendar-title">
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head">
        <h2 id="calendar-title">Google Calendar trip</h2>
        <button class="sheet__close" id="calendar-close" type="button" aria-label="Close">
          ${ICONS.close}
        </button>
      </div>

      <form id="calendar-form" class="calendar-form" autocomplete="off" novalidate>
        <label class="field field--stacked">
          <span class="field__label">Event title</span>
          <input
            id="calendar-event-title"
            class="add__name"
            name="title"
            type="text"
            maxlength="120"
          />
        </label>

        <div class="calendar-form__row">
          <label class="field field--stacked">
            <span class="field__label">Date</span>
            <input id="calendar-date" class="field__input" name="date" type="date" />
          </label>
          <label class="field field--stacked">
            <span class="field__label">Time</span>
            <input id="calendar-time" class="field__input" name="time" type="time" />
          </label>
        </div>

        <p id="calendar-summary" class="calendar-form__note"></p>

        <button class="btn btn--primary new-list__submit" type="submit">
          Open Google Calendar
        </button>
      </form>

      <p id="calendar-status" class="sheet__status" role="status" aria-live="polite"></p>
    </dialog>
  `;

  const refs = {
    nameSlot: root.querySelector('#name-slot'),
    renameButton: root.querySelector('#rename-btn'),
    selectButton: root.querySelector('#select-btn'),
    calendarButton: root.querySelector('#calendar-btn'),
    count: root.querySelector('#list-count'),
    chips: root.querySelector('#list-chips'),
    newListChip: root.querySelector('#new-list-chip'),
    warning: root.querySelector('#storage-warning'),
    items: root.querySelector('#items'),
    addDock: root.querySelector('#add-dock'),
    bulkDock: root.querySelector('#bulk-dock'),
    bulkCount: root.querySelector('#bulk-count'),
    bulkSelectAll: root.querySelector('#bulk-select-all'),
    bulkCancel: root.querySelector('#bulk-cancel'),
    bulkMove: root.querySelector('#bulk-move'),
    bulkDelete: root.querySelector('#bulk-delete'),
    bulkClear: root.querySelector('#bulk-clear'),
    fab: root.querySelector('#add-fab'),
    dialog: root.querySelector('#add-dialog'),
    sheetTitle: root.querySelector('#sheet-title'),
    closeButton: root.querySelector('#sheet-close'),
    form: root.querySelector('#add-form'),
    submitButton: root.querySelector('#add-submit'),
    nameInput: root.querySelector('#add-name'),
    qtyInput: root.querySelector('#add-qty'),
    unitInput: root.querySelector('#add-unit'),
    listField: root.querySelector('#add-list-field'),
    listLabel: root.querySelector('#add-list-label'),
    listSelect: root.querySelector('#add-list'),
    status: root.querySelector('#sheet-status'),
    newListDialog: root.querySelector('#new-list-dialog'),
    newListClose: root.querySelector('#new-list-close'),
    newListForm: root.querySelector('#new-list-form'),
    newListName: root.querySelector('#new-list-name'),
    presetChips: root.querySelector('#preset-chips'),
    newListStatus: root.querySelector('#new-list-status'),
    manageChip: root.querySelector('#manage-lists-chip'),
    manageDialog: root.querySelector('#manage-lists-dialog'),
    manageClose: root.querySelector('#manage-lists-close'),
    manageBody: root.querySelector('#manage-lists-body'),
    manageStatus: root.querySelector('#manage-lists-status'),
    moveDialog: root.querySelector('#move-dialog'),
    moveClose: root.querySelector('#move-close'),
    moveForm: root.querySelector('#move-form'),
    moveTitle: root.querySelector('#move-title'),
    moveSummary: root.querySelector('#move-summary'),
    moveOptions: root.querySelector('#move-options'),
    moveSubmit: root.querySelector('#move-submit'),
    moveStatus: root.querySelector('#move-status'),
    calendarDialog: root.querySelector('#calendar-dialog'),
    calendarClose: root.querySelector('#calendar-close'),
    calendarForm: root.querySelector('#calendar-form'),
    calendarEventTitle: root.querySelector('#calendar-event-title'),
    calendarDate: root.querySelector('#calendar-date'),
    calendarTime: root.querySelector('#calendar-time'),
    calendarSummary: root.querySelector('#calendar-summary'),
    calendarStatus: root.querySelector('#calendar-status'),
  };

  function currentList() {
    return store.getActiveList();
  }

  function render() {
    renderWarning();
    renderAddListOptions();

    const list = currentList();

    if (selecting && (!list || list.id !== selectionListId)) endSelection();
    if (selecting && list) {
      const currentIds = new Set(store.visibleItems(list).map((item) => item.id));
      for (const itemId of [...selectedItemIds]) {
        if (!currentIds.has(itemId)) selectedItemIds.delete(itemId);
      }
      if (!currentIds.size) endSelection();
    }

    renderChips();

    if (!list) {
      refs.nameSlot.replaceChildren(h('h1', { class: 'page-title' }, 'Groceries'));
      refs.count.textContent = '';
      refs.items.replaceChildren();
      refs.calendarButton.disabled = true;
      applySelectionMode();
      return;
    }

    refs.calendarButton.disabled = false;
    renderName(list);
    renderCount(list);
    renderItems(list);
    applySelectionMode();
    if (refs.manageDialog.open) renderManageLists();
  }

  function endSelection() {
    selecting = false;
    selectionListId = null;
    selectedItemIds.clear();
  }

  function startSelection() {
    const list = currentList();
    if (!list || !store.visibleItems(list).length) return;

    selecting = true;
    selectionListId = list.id;
    selectedItemIds.clear();
    render();
    refs.items.focus({ preventScroll: true });
  }

  function applySelectionMode() {
    const list = currentList();
    const visible = list ? store.visibleItems(list) : [];

    if (selecting && !visible.length) endSelection();

    refs.addDock.hidden = selecting;
    refs.bulkDock.hidden = !selecting;
    refs.selectButton.disabled = !visible.length;
    refs.selectButton.classList.toggle('is-active', selecting);
    refs.selectButton.setAttribute('aria-pressed', selecting ? 'true' : 'false');
    refs.selectButton.setAttribute('aria-label', selecting ? 'Cancel selection' : 'Select items');
    refs.selectButton.title = selecting ? 'Cancel selection' : 'Select items';
    refs.items.classList.toggle('is-selecting', selecting);
    refs.items.setAttribute(
      'aria-label',
      selecting ? 'Select items to move or remove' : 'List items'
    );
    document.body.classList.toggle('is-selecting', selecting);
    updateSelectionBar(visible);
  }

  function updateSelectionBar(visible = null) {
    const list = currentList();
    const items = visible || (list ? store.visibleItems(list) : []);
    const count = selectedItemIds.size;
    const allSelected = items.length > 0 && count === items.length;
    const otherLists = list
      ? store.visibleLists().filter((entry) => entry.id !== list.id)
      : [];

    refs.bulkCount.textContent = count
      ? `${count} selected`
      : 'Tap items to select';
    refs.bulkSelectAll.textContent = allSelected ? 'Deselect all' : 'Select all';
    refs.bulkSelectAll.disabled = !items.length;
    refs.bulkMove.disabled = count === 0;
    refs.bulkMove.title = otherLists.length
      ? 'Move selected items to another list'
      : 'Create another list before moving items';
    refs.bulkDelete.disabled = count === 0;
    refs.bulkClear.disabled = !items.length;
  }

  async function acquireWakeLock() {
    if (
      !store.getState().settings.keepAwake ||
      !('wakeLock' in navigator) ||
      document.visibilityState !== 'visible' ||
      wakeLock ||
      wakeLockPending
    ) {
      return;
    }

    wakeLockPending = true;
    try {
      const lock = await navigator.wakeLock.request('screen');
      wakeLock = lock;
      lock.addEventListener('release', () => {
        if (wakeLock === lock) wakeLock = null;
      });
    } catch (error) {
      // Wake Lock is best-effort; browsers may deny it when the battery is low.
      wakeLock = null;
    } finally {
      wakeLockPending = false;
    }
  }

  function releaseWakeLock() {
    if (!wakeLock) return;

    const lock = wakeLock;
    wakeLock = null;
    lock.release().catch(() => {});
  }

  function handleVisibilityChange() {
    if (document.visibilityState === 'visible') acquireWakeLock();
    else releaseWakeLock();
  }

  function renderWarning() {
    const info = store.getStorageInfo();
    const message =
      info.error ||
      (info.mode === 'memory'
        ? 'This browser is blocking storage, so changes will be lost when the tab closes.'
        : '');

    refs.warning.hidden = !message;
    refs.warning.textContent = message;
  }

  function renderAddListOptions({ forceActive = false } = {}) {
    const lists = store.visibleLists();
    const active = currentList();
    const activeId = active ? active.id : '';
    const previous = refs.listSelect.value;

    refs.listSelect.replaceChildren(
      ...lists.map((entry) => h('option', { value: entry.id }, entry.name))
    );

    const hasPrevious = lists.some((entry) => entry.id === previous);
    refs.listSelect.value =
      (!forceActive && hasPrevious ? previous : activeId) || (lists[0] && lists[0].id) || '';
    refs.listLabel.textContent = editingItemId ? 'Move to' : 'Add to';
    refs.listField.hidden = lists.length < 2;
    updateSubmitLabel();
  }

  function updateSubmitLabel() {
    if (!editingItemId) {
      refs.submitButton.textContent = 'Add';
      return;
    }

    const active = currentList();
    const targetId = refs.listSelect.value;
    refs.submitButton.textContent =
      active && targetId && targetId !== active.id ? 'Save & move' : 'Save';
  }

  function renderChips() {
    const list = currentList();
    const activeChipId = list ? `chip-${list.id}` : null;
    const shouldReveal = activeChipId !== lastActiveChipId;
    lastActiveChipId = activeChipId;

    const focusedId = document.activeElement && document.activeElement.id;
    const chips = store.visibleLists().map((entry) =>
      h(
        'button',
        {
          class: `list-chip${entry.id === (list && list.id) ? ' is-active' : ''}`,
          id: `chip-${entry.id}`,
          type: 'button',
          dataset: { listId: entry.id },
          'aria-pressed': entry.id === (list && list.id) ? 'true' : 'false',
        },
        entry.name
      )
    );

    const scrollLeft = refs.chips.scrollLeft;
    refs.chips.replaceChildren(...chips);
    refs.chips.scrollLeft = scrollLeft;

    if (focusedId) {
      const next = document.getElementById(focusedId);
      if (next) next.focus({ preventScroll: true });
    }

    if (shouldReveal) {
      const active = refs.chips.querySelector('.list-chip.is-active');
      if (active) revealChip(active);
    }
  }

  function revealChip(chip) {
    const chipRect = chip.getBoundingClientRect();
    const listRect = refs.chips.getBoundingClientRect();

    if (chipRect.left < listRect.left) {
      refs.chips.scrollLeft -= listRect.left - chipRect.left + 6;
    } else if (chipRect.right > listRect.right) {
      refs.chips.scrollLeft += chipRect.right - listRect.right + 6;
    }
  }

  function renderName(list) {
    refs.renameButton.disabled = renaming;

    if (!renaming) {
      const existing = refs.nameSlot.querySelector('h1');
      if (existing) existing.textContent = list.name;
      else refs.nameSlot.replaceChildren(h('h1', { class: 'page-title' }, list.name));
      return;
    }

    if (refs.nameSlot.querySelector('.rename-input')) return;

    const input = h('input', {
      id: 'rename-input',
      class: 'rename-input',
      type: 'text',
      value: list.name,
      maxlength: '60',
      'aria-label': 'List name',
      enterkeyhint: 'done',
      autocapitalize: 'sentences',
    });

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        input.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        input.value = list.name;
        input.blur();
      }
    });

    input.addEventListener('blur', commitRename);
    refs.nameSlot.replaceChildren(input);
    input.focus();
    input.select();
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function commitRename(event) {
    if (!renaming) return;

    renaming = false;
    const list = currentList();
    const value = event.target.value.trim();
    const changed = list && value ? store.renameList(list.id, value) : false;

    if (!changed) render();
  }

  function renderCount(list) {
    const items = store.visibleItems(list);
    const picked = items.filter((item) => item.checked).length;

    if (!items.length) refs.count.textContent = 'Nothing on the list yet';
    else if (picked === items.length) refs.count.textContent = `All ${items.length} picked`;
    else refs.count.textContent = `${picked} of ${items.length} picked`;
  }

  function renderItems(list) {
    const active = document.activeElement;
    const focusId = active && active.id ? active.id : null;
    const scrollY = window.scrollY;
    const visible = store.visibleItems(list);

    if (!visible.length) {
      refs.items.replaceChildren(
        h(
          'div',
          { class: 'empty empty--inline' },
          h('div', { class: 'empty__icon' }, icon('list')),
          h('h2', {}, 'Your list is empty'),
          h('p', {}, 'Tap Add item to start your list. It stays on this device.')
        )
      );
      return;
    }

    const order =
      Array.isArray(list.aisleOrder) && list.aisleOrder.length
        ? list.aisleOrder
        : store.getState().settings.aisleOrder;
    const buckets = new Map();

    for (const item of visible) {
      const aisle = order.includes(item.aisle) ? item.aisle : 'Other';
      if (!buckets.has(aisle)) buckets.set(aisle, []);
      buckets.get(aisle).push(item);
    }

    for (const items of buckets.values()) items.sort(compareItems);

    const fragment = document.createDocumentFragment();
    for (const aisle of order) {
      const items = buckets.get(aisle);
      if (!items || !items.length) continue;
      fragment.append(aisleSection(aisle, items));
    }

    refs.items.replaceChildren(fragment);

    if (focusId && focusId !== 'items') {
      const next = document.getElementById(focusId);
      if (next) next.focus({ preventScroll: true });
    }

    if (Math.abs(window.scrollY - scrollY) > 2) {
      window.scrollTo({ top: scrollY });
    }
  }

  function aisleSection(aisle, items) {
    const picked = items.filter((item) => item.checked).length;
    const complete = picked === items.length;

    return h(
      'section',
      { class: 'aisle', dataset: { aisle } },
      h(
        'h3',
        {
          class: 'aisle__title',
          'aria-label': `${aisle}, ${picked} of ${items.length} picked`,
        },
        h('span', { class: 'aisle__name' }, aisle),
        h(
          'span',
          {
            class: `aisle__progress${complete ? ' is-complete' : ''}`,
            'aria-hidden': 'true',
          },
          `${picked}/${items.length}`
        )
      ),
      h('ul', { class: 'item-list' }, items.map(itemNode))
    );
  }

  function renderManageLists() {
    const lists = store.visibleLists();
    const archived = store.getState().lists.filter((list) => list.archivedAt);
    const active = currentList();
    const nodes = [h('h3', { class: 'manage-section-title' }, 'Your lists')];

    if (lists.length) {
      nodes.push(
        h(
          'ul',
          { class: 'manage-list' },
          lists.map((list) => {
            const items = store.visibleItems(list);
            const picked = items.filter((item) => item.checked).length;
            const canArchive = lists.length > 1;
            const isActive = active && active.id === list.id;

            return h(
              'li',
              { class: 'manage-row', dataset: { listId: list.id } },
              h(
                'div',
                { class: 'manage-row__text' },
                h(
                  'p',
                  { class: 'manage-row__name' },
                  list.name,
                  isActive ? h('span', { class: 'badge' }, 'Active') : null
                ),
                h(
                  'p',
                  { class: 'manage-row__meta' },
                  items.length
                    ? `${items.length} item${items.length === 1 ? '' : 's'} · ${picked} picked`
                    : 'Empty list'
                )
              ),
              h(
                'div',
                { class: 'manage-row__actions' },
                h(
                  'button',
                  {
                    class: 'btn manage-btn',
                    type: 'button',
                    dataset: { action: 'duplicate', listId: list.id },
                  },
                  'Duplicate'
                ),
                h(
                  'button',
                  {
                    class: 'btn manage-btn',
                    type: 'button',
                    dataset: { action: 'archive', listId: list.id },
                    disabled: !canArchive,
                    title: canArchive ? null : 'Create another list before archiving this one.',
                  },
                  'Archive'
                )
              )
            );
          })
        )
      );
    }

    nodes.push(
      h(
        'h3',
        { class: 'manage-section-title manage-section-title--spaced' },
        `Archived${archived.length ? ` (${archived.length})` : ''}`
      )
    );

    if (archived.length) {
      nodes.push(
        h(
          'ul',
          { class: 'manage-list' },
          archived.map((list) => {
            const items = store.visibleItems(list);
            return h(
              'li',
              { class: 'manage-row manage-row--archived', dataset: { listId: list.id } },
              h(
                'div',
                { class: 'manage-row__text' },
                h('p', { class: 'manage-row__name' }, list.name),
                h(
                  'p',
                  { class: 'manage-row__meta' },
                  `${items.length} item${items.length === 1 ? '' : 's'} · archived`
                )
              ),
              h(
                'button',
                {
                  class: 'btn manage-btn',
                  type: 'button',
                  dataset: { action: 'restore', listId: list.id },
                },
                'Restore'
              )
            );
          })
        )
      );
    } else {
      nodes.push(h('p', { class: 'manage-empty' }, 'No archived lists.'));
    }

    refs.manageBody.replaceChildren(...nodes);
  }

  function itemNode(item) {
    const checkboxId = `cb-${item.id}`;
    const quantity = formatQuantity(item);
    const isSelected = selecting && selectedItemIds.has(item.id);
    const classes = [
      'item',
      !selecting && item.checked ? 'is-done' : '',
      isSelected ? 'is-selected' : '',
    ]
      .filter(Boolean)
      .join(' ');

    return h(
      'li',
      { class: classes, dataset: { id: item.id } },
      h(
        'label',
        { class: 'item__label', for: checkboxId },
        h('input', {
          class: 'item__checkbox',
          type: 'checkbox',
          id: checkboxId,
          checked: selecting ? isSelected : item.checked,
          dataset: { id: item.id, action: 'toggle' },
        }),
        h('span', { class: 'item__box', 'aria-hidden': 'true' }, icon('check')),
        h(
          'span',
          { class: 'item__text' },
          h('span', { class: 'item__name' }, item.name),
          quantity ? h('span', { class: 'item__qty' }, quantity) : null
        )
      ),
      selecting
        ? null
        : h(
            'div',
            { class: 'item__actions' },
            h(
              'button',
              {
                class: 'item__edit',
                type: 'button',
                dataset: { id: item.id, action: 'edit' },
                'aria-label': `Edit or move ${item.name}`,
                title: 'Edit or move',
              },
              icon('pencil')
            ),
            h(
              'button',
              {
                class: 'item__delete',
                type: 'button',
                dataset: { id: item.id, action: 'delete' },
                'aria-label': `Delete ${item.name}`,
              },
              icon('trash')
            )
          )
    );
  }

  /* ---------- Sheets ---------- */

  function prepareAddSheet() {
    refs.status.textContent = '';

    if (editingItemId) {
      const list = currentList();
      const item = list
        ? store.visibleItems(list).find((entry) => entry.id === editingItemId)
        : null;

      if (item) {
        refs.sheetTitle.textContent = 'Edit item';
        refs.submitButton.textContent = 'Save';
        refs.nameInput.value = item.name;
        refs.qtyInput.value = item.qty == null ? '' : String(item.qty);
        refs.unitInput.value = item.unit || '';
        renderAddListOptions({ forceActive: true });
        return;
      }

      editingItemId = null;
      refs.form.reset();
    }

    refs.sheetTitle.textContent = 'Add item';
    refs.submitButton.textContent = 'Add';
    renderAddListOptions({ forceActive: true });
  }

  function resetAddSheetMode() {
    if (!editingItemId) return;

    editingItemId = null;
    refs.form.reset();
    refs.sheetTitle.textContent = 'Add item';
    refs.submitButton.textContent = 'Add';
    renderAddListOptions({ forceActive: true });
  }

  function prepareMoveSheet() {
    const list = currentList();
    if (!list) {
      moveSheet.close();
      return;
    }

    const count = selectedItemIds.size;
    const targets = store.visibleLists().filter((entry) => entry.id !== list.id);

    refs.moveTitle.textContent = count === 1 ? 'Move 1 item' : `Move ${count} items`;
    refs.moveSummary.textContent = count
      ? `Choose a list for the selected item${count === 1 ? '' : 's'}. Matching items will combine quantities.`
      : 'Select at least one item first.';
    refs.moveStatus.textContent = '';
    refs.moveSubmit.disabled = !count || !targets.length;

    if (!targets.length) {
      refs.moveOptions.replaceChildren(
        h('p', { class: 'move-empty' }, 'Create another list before moving items.')
      );
      return;
    }

    refs.moveOptions.replaceChildren(
      ...targets.map((target, index) => {
        const itemCount = store.visibleItems(target).length;
        return h(
          'label',
          { class: 'move-option' },
          h('input', {
            type: 'radio',
            name: 'move-target',
            value: target.id,
            checked: index === 0,
          }),
          h(
            'span',
            { class: 'move-option__text' },
            h('span', { class: 'move-option__name' }, target.name),
            h(
              'span',
              { class: 'move-option__meta' },
              `${itemCount} item${itemCount === 1 ? '' : 's'}`
            )
          )
        );
      })
    );
  }

  const addSheet = createSheetController(refs.dialog, {
    trigger: () =>
      lastItemTrigger && lastItemTrigger.isConnected ? lastItemTrigger : refs.fab,
    initialFocus: () => refs.nameInput,
    selectOnOpen: true,
    onOpen: prepareAddSheet,
    onClose: () => {
      resetAddSheetMode();
      refs.status.textContent = '';
    },
  });

  const newListSheet = createSheetController(refs.newListDialog, {
    trigger: () => root.querySelector('.list-chip.is-active') || refs.newListChip,
    initialFocus: () => refs.newListName,
    selectOnOpen: true,
    onOpen: prepareNewListSheet,
    onClose: () => {
      refs.newListStatus.textContent = '';
    },
  });

  const manageListsSheet = createSheetController(refs.manageDialog, {
    trigger: () => refs.manageChip,
    initialFocus: () => refs.manageBody.querySelector('button') || refs.manageClose,
    onOpen: renderManageLists,
    onClose: () => {
      refs.manageStatus.textContent = '';
    },
  });

  const moveSheet = createSheetController(refs.moveDialog, {
    trigger: () => refs.selectButton,
    initialFocus: () => refs.moveOptions.querySelector('input') || refs.moveClose,
    onOpen: prepareMoveSheet,
    onClose: () => {
      refs.moveStatus.textContent = '';
    },
  });

  const calendarSheet = createSheetController(refs.calendarDialog, {
    trigger: () => refs.calendarButton,
    initialFocus: () => refs.calendarEventTitle,
    onOpen: populateCalendarSheet,
    onClose: () => {
      refs.calendarStatus.textContent = '';
    },
  });

  /* ---------- Add sheet ---------- */

  refs.fab.addEventListener('click', () => {
    lastItemTrigger = null;
    editingItemId = null;
    addSheet.open();
  });
  refs.closeButton.addEventListener('click', () => addSheet.close());
  refs.listSelect.addEventListener('change', updateSubmitLabel);

  refs.form.addEventListener('submit', (event) => {
    event.preventDefault();

    const active = currentList();
    if (!active) return;

    const name = refs.nameInput.value.trim();
    if (!name) {
      refs.nameInput.focus();
      return;
    }

    if (editingItemId) {
      const targetId = refs.listSelect.value;
      const target =
        store.visibleLists().find((entry) => entry.id === targetId && entry.id !== active.id) ||
        null;

      const item = store.updateItem(active.id, editingItemId, {
        name,
        qty: refs.qtyInput.value,
        unit: refs.unitInput.value,
      });

      if (!item) {
        refs.status.textContent = 'Could not save that item.';
        return;
      }

      if (target) {
        const moved = store.moveItem(active.id, item.id, target.id);
        if (!moved) {
          refs.status.textContent = 'Item saved, but it could not be moved.';
          return;
        }

        addSheet.close();
        showToast(
          moved.merged
            ? `Moved ${item.name} to ${target.name} and combined quantities.`
            : `Moved ${item.name} to ${target.name}.`
        );
        refs.items.focus({ preventScroll: true });
        return;
      }

      addSheet.close();
      showToast('Item updated');
      refs.items.focus({ preventScroll: true });
      return;
    }

    const targetId = refs.listSelect.value;
    const target =
      store.visibleLists().find((entry) => entry.id === targetId) || active;

    const item = store.addItem(target.id, {
      name,
      qty: refs.qtyInput.value,
      unit: refs.unitInput.value,
    });

    if (!item) {
      refs.status.textContent = 'Could not add that item.';
      return;
    }

    if (store.getState().settings.activeListId !== target.id) {
      store.setActiveList(target.id);
    }

    refs.form.reset();
    renderAddListOptions({ forceActive: true });
    refs.status.textContent = `Added ${item.name} to ${target.name}.`;
    refs.nameInput.focus({ preventScroll: true });
  });

  /* ---------- List chips ---------- */

  refs.chips.addEventListener('click', (event) => {
    const chip = event.target.closest('button[data-list-id]');
    if (!chip) return;

    const wasSelecting = selecting;
    if (selecting) endSelection();

    if (store.setActiveList(chip.dataset.listId)) {
      window.scrollTo({ top: 0 });
    } else if (wasSelecting) {
      render();
    }
  });

  refs.newListChip.addEventListener('click', () => newListSheet.open());

  /* ---------- Bulk selection ---------- */

  refs.selectButton.addEventListener('click', () => {
    if (renaming) return;

    if (selecting) {
      endSelection();
      render();
      refs.selectButton.focus({ preventScroll: true });
    } else {
      startSelection();
    }
  });

  refs.bulkCancel.addEventListener('click', () => {
    endSelection();
    render();
    refs.selectButton.focus({ preventScroll: true });
  });

  refs.bulkSelectAll.addEventListener('click', () => {
    const list = currentList();
    if (!list) return;

    const visible = store.visibleItems(list);
    if (visible.length && selectedItemIds.size === visible.length) {
      selectedItemIds.clear();
    } else {
      for (const item of visible) selectedItemIds.add(item.id);
    }

    render();
    refs.bulkSelectAll.focus({ preventScroll: true });
  });

  refs.bulkMove.addEventListener('click', () => {
    if (!selectedItemIds.size) return;
    moveSheet.open();
  });

  refs.bulkDelete.addEventListener('click', () => {
    const list = currentList();
    const ids = [...selectedItemIds];
    if (!list || !ids.length) return;

    endSelection();
    const result = store.deleteItems(list.id, ids);
    if (!result || !result.deleted) {
      render();
      showToast('Those items could not be removed.');
      return;
    }

    const count = result.deleted;
    showToast(`Removed ${count} item${count === 1 ? '' : 's'}.`, {
      duration: 6000,
      actionLabel: 'Undo',
      onAction: () => {
        const restored = store.restoreItems(list.id, result.itemIds);
        if (!restored || !restored.restored) {
          showToast('Could not restore those items.');
          return;
        }
        showToast(`${restored.restored} item${restored.restored === 1 ? '' : 's'} restored.`);
        refs.items.focus({ preventScroll: true });
      },
    });
    refs.items.focus({ preventScroll: true });
  });

  refs.bulkClear.addEventListener('click', () => {
    const list = currentList();
    if (!list) return;

    const visible = store.visibleItems(list);
    if (!visible.length) return;

    const count = visible.length;
    if (
      !window.confirm(
        `Remove all ${count} item${count === 1 ? '' : 's'} from “${list.name}”? You can undo this.`
      )
    ) {
      return;
    }

    endSelection();
    const result = store.clearList(list.id);
    if (!result || !result.cleared) {
      render();
      showToast('Could not clear that list.');
      return;
    }

    showToast(`Cleared ${result.cleared} item${result.cleared === 1 ? '' : 's'}.`, {
      duration: 6000,
      actionLabel: 'Undo',
      onAction: () => {
        const restored = store.restoreItems(list.id, result.itemIds);
        if (!restored || !restored.restored) {
          showToast('Could not restore those items.');
          return;
        }
        showToast(`${restored.restored} item${restored.restored === 1 ? '' : 's'} restored.`);
        refs.items.focus({ preventScroll: true });
      },
    });
    refs.items.focus({ preventScroll: true });
  });

  refs.moveClose.addEventListener('click', () => moveSheet.close());

  refs.moveForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const list = currentList();
    const targetId = refs.moveForm.querySelector('input[name="move-target"]:checked')?.value;
    const target = store.visibleLists().find((entry) => entry.id === targetId);
    if (!list || !target || !selectedItemIds.size) {
      refs.moveStatus.textContent = 'Choose another list before moving items.';
      return;
    }

    const ids = [...selectedItemIds];
    const result = store.moveItems(list.id, ids, target.id);
    if (!result || !result.moved) {
      refs.moveStatus.textContent = 'Those items could not be moved.';
      return;
    }

    endSelection();
    moveSheet.close();
    render();
    const combined = result.merged
      ? ` ${result.merged} matching item${result.merged === 1 ? '' : 's'} combined.`
      : '';
    showToast(
      `Moved ${result.moved} item${result.moved === 1 ? '' : 's'} to ${target.name}.${combined}`
    );
    refs.items.focus({ preventScroll: true });
  });

  /* ---------- New list sheet ---------- */

  function prepareNewListSheet() {
    const existing = new Set(store.visibleLists().map((list) => list.storeKey));
    selectedPreset =
      ['kroger', 'wholefoods', 'costco'].find((key) => !existing.has(key)) || 'custom';

    renderPresetChips();
    refs.newListName.value =
      selectedPreset === 'custom' ? '' : STORE_PRESETS[selectedPreset].name;
    refs.newListStatus.textContent = '';
  }

  function renderPresetChips() {
    refs.presetChips.replaceChildren(
      ...PRESET_ORDER.map((key) => {
        const preset = STORE_PRESETS[key];
        if (!preset) return null;

        return h(
          'button',
          {
            class: `preset-chip${selectedPreset === key ? ' is-selected' : ''}`,
            type: 'button',
            dataset: { preset: key },
            'aria-pressed': selectedPreset === key ? 'true' : 'false',
          },
          preset.label
        );
      }).filter(Boolean)
    );
  }

  refs.presetChips.addEventListener('click', (event) => {
    const chip = event.target.closest('button[data-preset]');
    if (!chip) return;

    const key = chip.dataset.preset;
    if (!STORE_PRESETS[key]) return;

    selectedPreset = key;
    renderPresetChips();
    refs.newListName.value = key === 'custom' ? '' : STORE_PRESETS[key].name;
    refs.newListStatus.textContent = '';
    refs.newListName.focus({ preventScroll: true });
    refs.newListName.select();
  });

  refs.newListClose.addEventListener('click', () => newListSheet.close());

  refs.newListForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const name = refs.newListName.value.trim();
    if (!name) {
      refs.newListStatus.textContent = 'Give the list a name.';
      refs.newListName.focus();
      return;
    }

    const preset = STORE_PRESETS[selectedPreset] || STORE_PRESETS.custom;
    const list = store.addList({
      name,
      storeKey: selectedPreset,
      aisleOrder: preset.aisleOrder,
    });

    newListSheet.close();
    showToast(`${list.name} list created.`);
  });

  /* ---------- Manage lists ---------- */

  refs.manageChip.addEventListener('click', () => manageListsSheet.open());
  refs.manageClose.addEventListener('click', () => manageListsSheet.close());

  refs.manageBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const listId = button.dataset.listId;
    refs.manageStatus.textContent = '';

    if (button.dataset.action === 'duplicate') {
      const copy = store.duplicateList(listId);
      if (!copy) {
        refs.manageStatus.textContent = 'Could not duplicate that list.';
        return;
      }
      showToast(`${copy.name} created.`);
      return;
    }

    if (button.dataset.action === 'archive') {
      const list = store.visibleLists().find((entry) => entry.id === listId);
      const archived = store.archiveList(listId);
      if (!archived) {
        refs.manageStatus.textContent = 'Create another list before archiving this one.';
        return;
      }
      showToast(`${archived.name} archived.${list ? ' Items are safe.' : ''}`);
      return;
    }

    if (button.dataset.action === 'restore') {
      const restored = store.restoreList(listId);
      if (!restored) {
        refs.manageStatus.textContent = 'Could not restore that list.';
        return;
      }
      showToast(`${restored.name} restored.`);
    }
  });

  /* ---------- Calendar sheet ---------- */

  function todayInputValue() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(
      now.getDate()
    ).padStart(2, '0')}`;
  }

  function populateCalendarSheet() {
    const list = currentList();
    if (!list) return;

    const items = store.visibleItems(list);

    refs.calendarEventTitle.value = list.name;
    refs.calendarDate.value = todayInputValue();
    refs.calendarTime.value = '17:00';
    refs.calendarSummary.textContent = `${items.length} item${
      items.length === 1 ? '' : 's'
    } will go in the event description. You can still edit the event in Google Calendar.`;
    refs.calendarStatus.textContent = '';
  }

  refs.calendarButton.addEventListener('click', () => {
    const list = currentList();
    if (!list) return;

    if (!store.visibleItems(list).length) {
      showToast('Add items before creating a trip.');
      return;
    }

    calendarSheet.open();
  });

  refs.calendarClose.addEventListener('click', () => calendarSheet.close());

  refs.calendarForm.addEventListener('submit', (event) => {
    event.preventDefault();

    const list = currentList();
    if (!list) return;

    const title = refs.calendarEventTitle.value.trim();
    const date = refs.calendarDate.value;
    const time = refs.calendarTime.value;

    if (!title) {
      refs.calendarStatus.textContent = 'Give the event a title.';
      refs.calendarEventTitle.focus();
      return;
    }

    if (!date || !time) {
      refs.calendarStatus.textContent = 'Choose a date and time.';
      return;
    }

    try {
      const url = buildGoogleCalendarUrl({ list, title, date, time });
      window.open(url, '_blank', 'noopener,noreferrer');
      calendarSheet.close();
      showToast('Opening Google Calendar…');
    } catch (error) {
      refs.calendarStatus.textContent = error.message || 'Could not create the event.';
    }
  });

  /* ---------- List items ---------- */

  refs.items.addEventListener('change', (event) => {
    const checkbox = event.target.closest('input[data-action="toggle"]');
    if (!checkbox) return;

    const list = currentList();
    if (!list) return;

    if (selecting) {
      if (checkbox.checked) selectedItemIds.add(checkbox.dataset.id);
      else selectedItemIds.delete(checkbox.dataset.id);

      const row = checkbox.closest('.item');
      if (row) row.classList.toggle('is-selected', checkbox.checked);
      updateSelectionBar();
      return;
    }

    store.setItemChecked(list.id, checkbox.dataset.id, checkbox.checked);
  });

  refs.items.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const list = currentList();
    if (!list) return;

    if (button.dataset.action === 'edit') {
      lastItemTrigger = button;
      editingItemId = button.dataset.id;
      addSheet.open();
      return;
    }

    if (button.dataset.action === 'delete') {
      const item = store
        .visibleItems(list)
        .find((entry) => entry.id === button.dataset.id);
      if (!item || !store.deleteItem(list.id, item.id)) return;

      showToast(`Removed ${item.name}.`, {
        duration: 6000,
        actionLabel: 'Undo',
        onAction: () => {
          const restored = store.restoreItem(list.id, item.id);
          if (!restored) {
            showToast('Could not restore that item.');
            return;
          }
          showToast('Item restored.');
          refs.items.focus({ preventScroll: true });
        },
      });
      refs.items.focus({ preventScroll: true });
    }
  });

  refs.renameButton.addEventListener('click', () => {
    const list = currentList();
    if (!list || renaming) return;

    renaming = true;
    renderName(list);
  });

  const unsubscribe = store.subscribe(render);
  render();
  document.addEventListener('visibilitychange', handleVisibilityChange);
  acquireWakeLock();

  return () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    releaseWakeLock();
    addSheet.destroy();
    newListSheet.destroy();
    manageListsSheet.destroy();
    moveSheet.destroy();
    calendarSheet.destroy();
    document.body.classList.remove('has-add-dock');
    document.body.classList.remove('is-selecting');
  };
}

function compareItems(a, b) {
  // Picked items still sink within their aisle; the rest read A–Z.
  if (a.checked !== b.checked) return a.checked ? 1 : -1;

  const byName = String(a.name).localeCompare(String(b.name), undefined, {
    sensitivity: 'base',
    numeric: true,
  });
  if (byName) return byName;

  return String(a.addedAt).localeCompare(String(b.addedAt));
}
