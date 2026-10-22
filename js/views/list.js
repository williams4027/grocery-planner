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
    </div>

    <div id="storage-warning" class="banner" role="status" hidden></div>

    <section class="card list-card" aria-label="Grocery list">
      <div id="items" class="items" tabindex="-1" aria-label="List items"></div>
    </section>

    <div class="add-dock">
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
          <button class="btn btn--primary add__submit" type="submit">Add</button>
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
          <span class="field__label">Add to</span>
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
    calendarButton: root.querySelector('#calendar-btn'),
    count: root.querySelector('#list-count'),
    chips: root.querySelector('#list-chips'),
    newListChip: root.querySelector('#new-list-chip'),
    warning: root.querySelector('#storage-warning'),
    items: root.querySelector('#items'),
    fab: root.querySelector('#add-fab'),
    dialog: root.querySelector('#add-dialog'),
    closeButton: root.querySelector('#sheet-close'),
    form: root.querySelector('#add-form'),
    nameInput: root.querySelector('#add-name'),
    qtyInput: root.querySelector('#add-qty'),
    unitInput: root.querySelector('#add-unit'),
    listField: root.querySelector('#add-list-field'),
    listSelect: root.querySelector('#add-list'),
    status: root.querySelector('#sheet-status'),
    newListDialog: root.querySelector('#new-list-dialog'),
    newListClose: root.querySelector('#new-list-close'),
    newListForm: root.querySelector('#new-list-form'),
    newListName: root.querySelector('#new-list-name'),
    presetChips: root.querySelector('#preset-chips'),
    newListStatus: root.querySelector('#new-list-status'),
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
    renderChips();

    if (!list) {
      refs.nameSlot.replaceChildren(h('h1', { class: 'page-title' }, 'Groceries'));
      refs.count.textContent = '';
      refs.items.replaceChildren();
      refs.calendarButton.disabled = true;
      return;
    }

    refs.calendarButton.disabled = false;
    renderName(list);
    renderCount(list);
    renderItems(list);
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
    refs.listField.hidden = lists.length < 2;
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
    return h(
      'section',
      { class: 'aisle', dataset: { aisle } },
      h('h3', { class: 'aisle__title' }, aisle),
      h('ul', { class: 'item-list' }, items.map(itemNode))
    );
  }

  function itemNode(item) {
    const checkboxId = `cb-${item.id}`;
    const quantity = formatQuantity(item);

    return h(
      'li',
      { class: `item${item.checked ? ' is-done' : ''}`, dataset: { id: item.id } },
      h(
        'label',
        { class: 'item__label', for: checkboxId },
        h('input', {
          class: 'item__checkbox',
          type: 'checkbox',
          id: checkboxId,
          checked: item.checked,
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
    );
  }

  /* ---------- Sheets ---------- */

  const addSheet = createSheetController(refs.dialog, {
    trigger: () => refs.fab,
    initialFocus: () => refs.nameInput,
    selectOnOpen: true,
    onOpen: () => {
      renderAddListOptions({ forceActive: true });
      refs.status.textContent = '';
    },
    onClose: () => {
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

  const calendarSheet = createSheetController(refs.calendarDialog, {
    trigger: () => refs.calendarButton,
    initialFocus: () => refs.calendarEventTitle,
    onOpen: populateCalendarSheet,
    onClose: () => {
      refs.calendarStatus.textContent = '';
    },
  });

  /* ---------- Add sheet ---------- */

  refs.fab.addEventListener('click', () => addSheet.open());
  refs.closeButton.addEventListener('click', () => addSheet.close());

  refs.form.addEventListener('submit', (event) => {
    event.preventDefault();

    const active = currentList();
    if (!active) return;

    const name = refs.nameInput.value.trim();
    if (!name) {
      refs.nameInput.focus();
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

    if (store.setActiveList(chip.dataset.listId)) {
      window.scrollTo({ top: 0 });
    }
  });

  refs.newListChip.addEventListener('click', () => newListSheet.open());

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

    store.setItemChecked(list.id, checkbox.dataset.id, checkbox.checked);
  });

  refs.items.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action="delete"]');
    if (!button) return;

    const list = currentList();
    if (!list) return;

    store.deleteItem(list.id, button.dataset.id);
    showToast('Item removed');
    refs.items.focus({ preventScroll: true });
  });

  refs.renameButton.addEventListener('click', () => {
    const list = currentList();
    if (!list || renaming) return;

    renaming = true;
    renderName(list);
  });

  const unsubscribe = store.subscribe(render);
  render();

  return () => {
    unsubscribe();
    addSheet.destroy();
    newListSheet.destroy();
    calendarSheet.destroy();
    document.body.classList.remove('has-add-dock');
  };
}

function compareItems(a, b) {
  if (a.checked !== b.checked) return a.checked ? 1 : -1;
  return String(a.addedAt).localeCompare(String(b.addedAt));
}
