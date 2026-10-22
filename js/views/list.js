/* Grocery list view — Phase 1 */

import * as store from '../store.js';
import { h, icon, showToast, formatQuantity } from '../ui.js';

export function mount(root) {
  let renaming = false;

  root.innerHTML = `
    <header class="page-head">
      <div class="page-head__text">
        <div id="name-slot"></div>
        <p class="list-count" id="list-count" aria-live="polite"></p>
      </div>
      <button class="ghost-btn" id="rename-btn" type="button">Rename</button>
    </header>

    <div id="storage-warning" class="banner" role="status" hidden></div>

    <section class="card list-card" aria-label="Grocery list">
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
            <span class="field__label">Unit</span>
            <input
              id="add-unit"
              class="field__input"
              name="unit"
              type="text"
              maxlength="12"
              placeholder="lb, bag…"
            />
          </label>
        </div>
      </form>
      <div id="items" class="items" tabindex="-1" aria-label="List items"></div>
    </section>
  `;

  const refs = {
    nameSlot: root.querySelector('#name-slot'),
    renameButton: root.querySelector('#rename-btn'),
    count: root.querySelector('#list-count'),
    warning: root.querySelector('#storage-warning'),
    form: root.querySelector('#add-form'),
    nameInput: root.querySelector('#add-name'),
    qtyInput: root.querySelector('#add-qty'),
    unitInput: root.querySelector('#add-unit'),
    items: root.querySelector('#items'),
  };

  function currentList() {
    return store.getActiveList();
  }

  function render() {
    renderWarning();

    const list = currentList();
    if (!list) {
      refs.nameSlot.replaceChildren(h('h1', { class: 'page-title' }, 'Groceries'));
      refs.count.textContent = '';
      refs.items.replaceChildren();
      return;
    }

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

    if (list && value) store.renameList(list.id, value);
    render();
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
          h('p', {}, 'Add the first item above — it stays on this device.')
        )
      );
      return;
    }

    const order = store.getState().settings.aisleOrder;
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

  refs.renameButton.addEventListener('click', () => {
    const list = currentList();
    if (!list || renaming) return;

    renaming = true;
    renderName(list);
  });

  refs.form.addEventListener('submit', (event) => {
    event.preventDefault();

    const list = currentList();
    if (!list) return;

    const name = refs.nameInput.value.trim();
    if (!name) {
      refs.nameInput.focus();
      return;
    }

    store.addItem(list.id, {
      name,
      qty: refs.qtyInput.value,
      unit: refs.unitInput.value,
    });

    refs.nameInput.value = '';
    refs.qtyInput.value = '';
    refs.unitInput.value = '';
    refs.nameInput.focus();
  });

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

  const unsubscribe = store.subscribe(render);
  render();

  return unsubscribe;
}

function compareItems(a, b) {
  if (a.checked !== b.checked) return a.checked ? 1 : -1;
  return String(a.addedAt).localeCompare(String(b.addedAt));
}
