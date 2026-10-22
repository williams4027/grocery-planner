/* Meal plan — 7 days x 3 slots with automatic list additions. */

import { PLAN_SLOTS, PLAN_SLOT_LABELS } from '../config.js';
import * as store from '../store.js';
import {
  addDays,
  fromDateKey,
  startOfWeek,
  toDateKey,
} from '../dates.js';
import { createSheetController } from '../sheet.js';
import { h, icon, ICONS, showToast } from '../ui.js';

const WEEKDAY = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const MONTH_DAY = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const LONG_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
});

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function formatWeekRange(start, end) {
  if (start.getFullYear() !== end.getFullYear()) {
    return `${MONTH_DAY.format(start)}, ${start.getFullYear()} – ${MONTH_DAY.format(end)}, ${end.getFullYear()}`;
  }

  if (start.getMonth() === end.getMonth()) {
    return `${MONTH_DAY.format(start)} – ${end.getDate()}, ${end.getFullYear()}`;
  }

  return `${MONTH_DAY.format(start)} – ${MONTH_DAY.format(end)}, ${end.getFullYear()}`;
}

function clampServings(value) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return 1;
  return Math.max(1, Math.min(99, number));
}

export function mount(root) {
  const weekStart = store.getState().settings.weekStart === 'mon' ? 'mon' : 'sun';
  let anchor = startOfWeek(new Date(), weekStart);
  let selectedDate = null;
  let selectedSlot = null;
  let selectedTrigger = null;
  let planMode = 'pick';

  root.innerHTML = `
    <header class="page-head">
      <div class="page-head__text">
        <h1 class="page-title">Meal plan</h1>
        <p class="list-count" id="plan-count" aria-live="polite"></p>
      </div>
      <div class="page-head__actions">
        <button class="btn plan-today-btn" id="plan-today" type="button">Today</button>
      </div>
    </header>

    <p class="lede">
      Pick a recipe for any slot and its ingredients go straight to your chosen list.
    </p>

    <section class="card plan-card" aria-labelledby="week-title">
      <div class="card__head plan-card__head">
        <div class="plan-week__heading">
          <h2 id="week-title">This week</h2>
          <p id="week-range" class="plan-week__range"></p>
        </div>
        <div class="plan-week__nav" role="group" aria-label="Week navigation">
          <button
            class="icon-btn plan-week__prev"
            id="week-prev"
            type="button"
            aria-label="Previous week"
            title="Previous week"
          >
            ${ICONS.chevron}
          </button>
          <button
            class="icon-btn"
            id="week-next"
            type="button"
            aria-label="Next week"
            title="Next week"
          >
            ${ICONS.chevron}
          </button>
        </div>
      </div>

      <div class="plan-target">
        <label class="field field--stacked">
          <span class="field__label">Add ingredients to</span>
          <select id="plan-target-list" class="field__input"></select>
        </label>
        <p id="plan-target-note" class="card__note"></p>
      </div>

      <div id="plan-week" class="plan-week"></div>

      <div class="plan-week__footer">
        <button class="btn" id="plan-copy" type="button">Copy last week</button>
        <p class="card__note">
          Copies into empty slots only. Custom meals stay on the plan and do not add ingredients.
        </p>
      </div>
    </section>

    <dialog id="plan-dialog" class="sheet plan-sheet" aria-labelledby="plan-dialog-title">
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head">
        <h2 id="plan-dialog-title">Plan meal</h2>
        <button class="sheet__close" id="plan-dialog-close" type="button" aria-label="Close">
          ${ICONS.close}
        </button>
      </div>
      <p id="plan-dialog-context" class="recipe-detail__meta"></p>
      <div id="plan-dialog-body"></div>
      <p id="plan-dialog-status" class="sheet__status" role="status" aria-live="polite"></p>
    </dialog>
  `;

  const refs = {
    count: root.querySelector('#plan-count'),
    title: root.querySelector('#week-title'),
    range: root.querySelector('#week-range'),
    today: root.querySelector('#plan-today'),
    prev: root.querySelector('#week-prev'),
    next: root.querySelector('#week-next'),
    targetList: root.querySelector('#plan-target-list'),
    targetNote: root.querySelector('#plan-target-note'),
    week: root.querySelector('#plan-week'),
    copy: root.querySelector('#plan-copy'),
    dialog: root.querySelector('#plan-dialog'),
    dialogTitle: root.querySelector('#plan-dialog-title'),
    dialogContext: root.querySelector('#plan-dialog-context'),
    dialogBody: root.querySelector('#plan-dialog-body'),
    dialogStatus: root.querySelector('#plan-dialog-status'),
    dialogClose: root.querySelector('#plan-dialog-close'),
  };

  const planSheet = createSheetController(refs.dialog, {
    trigger: () => {
      if (selectedDate && selectedSlot) {
        const next = root.querySelector(
          `[data-plan-date="${selectedDate}"][data-plan-slot="${selectedSlot}"]`
        );
        if (next) return next;
      }
      return selectedTrigger && selectedTrigger.isConnected ? selectedTrigger : refs.week;
    },
    initialFocus: () =>
      refs.dialogBody.querySelector('#plan-recipe-search') ||
      refs.dialogBody.querySelector('#plan-servings') ||
      refs.dialogBody.querySelector('#plan-custom-name') ||
      refs.dialogClose,
    onClose: () => {
      refs.dialogStatus.textContent = '';
      planMode = 'pick';
    },
  });

  function renderTarget() {
    const lists = store.visibleLists();
    const active = store.getActiveList();

    refs.targetList.replaceChildren(
      ...lists.map((list) => h('option', { value: list.id }, list.name))
    );
    refs.targetList.value = active ? active.id : '';
    refs.targetList.disabled = !lists.length;
    refs.targetNote.textContent = active
      ? `Recipes add their ingredients to ${active.name}.`
      : 'Create a grocery list first.';
  }

  function weekEntries() {
    const end = addDays(anchor, 6);
    return store.getPlanEntriesInRange(toDateKey(anchor), toDateKey(end));
  }

  function weekTitle() {
    const currentStart = startOfWeek(new Date(), weekStart);
    const currentKey = toDateKey(currentStart);
    const thisKey = toDateKey(anchor);

    if (thisKey === currentKey) return 'This week';
    if (thisKey === toDateKey(addDays(currentStart, 7))) return 'Next week';
    if (thisKey === toDateKey(addDays(currentStart, -7))) return 'Last week';
    return `Week of ${MONTH_DAY.format(anchor)}`;
  }

  function renderWeek() {
    const entries = weekEntries();
    const end = addDays(anchor, 6);
    const currentStart = startOfWeek(new Date(), weekStart);
    const todayKey = toDateKey(new Date());
    const entryMap = new Map(entries.map((entry) => [`${entry.date}:${entry.slot}`, entry]));

    refs.title.textContent = weekTitle();
    refs.range.textContent = formatWeekRange(anchor, end);
    refs.today.hidden = toDateKey(anchor) === toDateKey(currentStart);
    refs.count.textContent = entries.length
      ? `${countLabel(entries.length, 'meal')} planned`
      : 'Nothing planned this week';

    const fragment = document.createDocumentFragment();

    for (let index = 0; index < 7; index += 1) {
      const date = addDays(anchor, index);
      const dateKey = toDateKey(date);
      const dayEntries = entries.filter((entry) => entry.date === dateKey);
      const isToday = dateKey === todayKey;

      fragment.append(
        h(
          'section',
          { class: `plan-day${isToday ? ' is-today' : ''}`, dataset: { date: dateKey } },
          h(
            'div',
            { class: 'plan-day__head' },
            h(
              'h3',
              { class: 'plan-day__title' },
              `${WEEKDAY.format(date)} `,
              h('span', {}, MONTH_DAY.format(date))
            ),
            isToday ? h('span', { class: 'plan-day__today' }, 'Today') : null,
            dayEntries.length
              ? h(
                  'button',
                  {
                    class: 'plan-day__clear',
                    type: 'button',
                    dataset: { action: 'clear-day', date: dateKey },
                    'aria-label': `Clear ${WEEKDAY.format(date)}`,
                  },
                  'Clear'
                )
              : null
          ),
          h(
            'div',
            { class: 'plan-day__slots' },
            ...PLAN_SLOTS.map((slot) =>
              slotNode(date, dateKey, slot, entryMap.get(`${dateKey}:${slot}`))
            )
          )
        )
      );
    }

    refs.week.replaceChildren(fragment);
  }

  function slotNode(date, dateKey, slot, entry) {
    const label = PLAN_SLOT_LABELS[slot];
    const recipe = entry && entry.recipeId ? store.getRecipe(entry.recipeId) : null;
    const title = recipe ? recipe.title : entry ? entry.title : `Add ${label.toLowerCase()}`;
    let meta = '';

    if (entry) {
      if (recipe) {
        meta = `${countLabel(entry.servings, 'serving')} · ${countLabel(
          recipe.ingredients.length,
          'ingredient'
        )}`;
      } else if (entry.recipeId) {
        meta = 'Recipe removed';
      } else {
        meta = 'Custom meal';
      }
    }

    return h(
      'button',
      {
        class: `plan-slot${entry ? ' is-filled' : ''}`,
        type: 'button',
        dataset: { action: 'slot', planDate: dateKey, planSlot: slot },
        'aria-label': entry
          ? `Edit ${label.toLowerCase()} for ${WEEKDAY.format(date)}: ${title}`
          : `Add ${label.toLowerCase()} for ${WEEKDAY.format(date)}`,
      },
      h('span', { class: 'plan-slot__label' }, label),
      h(
        'span',
        { class: 'plan-slot__body' },
        h('span', { class: 'plan-slot__meal' }, title),
        meta
          ? h(
              'span',
              {
                class: `plan-slot__meta${
                  entry && entry.recipeId && !recipe ? ' plan-slot__meta--warn' : ''
                }`,
              },
              meta
            )
          : null
      ),
      h(
        'span',
        { class: 'plan-slot__action', 'aria-hidden': 'true' },
        entry ? icon('chevron') : '+'
      )
    );
  }

  function openSlot(dateKey, slot, trigger) {
    selectedDate = dateKey;
    selectedSlot = slot;
    selectedTrigger = trigger || null;
    planMode = store.getPlanEntry(dateKey, slot) ? 'edit' : 'pick';
    refs.dialogContext.textContent = `${LONG_DATE.format(
      fromDateKey(dateKey)
    )} · ${PLAN_SLOT_LABELS[slot]}`;
    refs.dialogStatus.textContent = '';
    renderDialog();
    planSheet.open();
  }

  function renderDialog() {
    const entry = store.getPlanEntry(selectedDate, selectedSlot);
    const label = PLAN_SLOT_LABELS[selectedSlot];
    refs.dialogTitle.textContent = `Plan ${label.toLowerCase()}`;

    if (planMode === 'edit' && entry) renderEdit(entry);
    else renderPicker(entry);
  }

  function renderEdit(entry) {
    const recipe = entry.recipeId ? store.getRecipe(entry.recipeId) : null;
    const active = store.getActiveList();
    const title = recipe ? recipe.title : entry.title;
    const meta = recipe
      ? `${recipe.category} · ${countLabel(recipe.ingredients.length, 'ingredient')}`
      : 'Custom meal';
    const nodes = [
      h(
        'div',
        { class: 'plan-current' },
        h('h3', { class: 'plan-current__title' }, title),
        h('p', { class: 'plan-current__meta' }, meta)
      ),
    ];

    if (recipe) {
      nodes.push(
        h(
          'p',
          { class: 'recipe-detail__to' },
          active ? `Ingredients go to ${active.name}.` : 'Create a grocery list first.'
        ),
        h(
          'div',
          { class: 'plan-servings' },
          h('span', { class: 'field__label' }, 'Servings'),
          h(
            'div',
            { class: 'plan-stepper' },
            h(
              'button',
              {
                class: 'plan-stepper__btn',
                type: 'button',
                dataset: { action: 'servings-down' },
                'aria-label': 'Fewer servings',
              },
              '−'
            ),
            h('input', {
              class: 'plan-stepper__input',
              id: 'plan-servings',
              type: 'number',
              inputmode: 'numeric',
              min: '1',
              max: '99',
              step: '1',
              value: String(entry.servings),
              'aria-label': 'Planned servings',
            }),
            h(
              'button',
              {
                class: 'plan-stepper__btn',
                type: 'button',
                dataset: { action: 'servings-up' },
                'aria-label': 'More servings',
              },
              '+'
            )
          ),
          h('span', { class: 'plan-servings__note' }, `Recipe makes ${recipe.servings}`)
        ),
        h(
          'div',
          { class: 'plan-actions' },
          h(
            'button',
            {
              class: 'btn btn--primary',
              type: 'button',
              dataset: { action: 'update-plan' },
            },
            recipe.ingredients.length ? 'Update ingredients' : 'Save servings'
          ),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              dataset: { action: 'change-recipe' },
            },
            'Change recipe'
          )
        )
      );
    } else {
      nodes.push(
        h(
          'label',
          { class: 'field field--stacked' },
          h('span', { class: 'field__label' }, 'Meal name'),
          h('input', {
            class: 'field__input',
            id: 'plan-custom-name',
            type: 'text',
            maxlength: '100',
            value: entry.title,
            autocapitalize: 'sentences',
            enterkeyhint: 'done',
          })
        ),
        h(
          'div',
          { class: 'plan-actions' },
          h(
            'button',
            {
              class: 'btn btn--primary',
              type: 'button',
              dataset: { action: 'save-custom' },
            },
            'Save meal'
          ),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              dataset: { action: 'change-recipe' },
            },
            'Choose a recipe'
          )
        )
      );
    }

    nodes.push(
      h(
        'button',
        {
          class: 'recipe-remove',
          type: 'button',
          dataset: { action: 'remove-plan' },
        },
        'Remove from plan'
      )
    );

    refs.dialogBody.replaceChildren(...nodes);
  }

  function renderPicker(entry) {
    const active = store.getActiveList();
    const nodes = [];

    if (entry) {
      nodes.push(
        h(
          'button',
          {
            class: 'btn plan-back',
            type: 'button',
            dataset: { action: 'back-to-edit' },
          },
          'Back to planned meal'
        )
      );
    }

    nodes.push(
      h('label', { class: 'sr-only', for: 'plan-recipe-search' }, 'Search recipes'),
      h('input', {
        class: 'recipe-search',
        id: 'plan-recipe-search',
        type: 'search',
        placeholder: 'Search recipes',
        autocomplete: 'off',
        enterkeyhint: 'search',
      }),
      h('div', { class: 'plan-recipe-list', id: 'plan-recipe-list' }),
      h(
        'form',
        {
          class: 'plan-custom',
          autocomplete: 'off',
          on: { submit: handleCustomSubmit },
        },
        h(
          'label',
          { class: 'field field--stacked' },
          h('span', { class: 'field__label' }, 'Or type a meal'),
          h('input', {
            class: 'field__input',
            id: 'plan-custom-name',
            type: 'text',
            maxlength: '100',
            placeholder: 'e.g. Leftovers',
            value: entry && !entry.recipeId ? entry.title : '',
            autocapitalize: 'sentences',
            enterkeyhint: 'done',
          })
        ),
        h('button', { class: 'btn', type: 'submit' }, 'Save custom meal')
      ),
      h(
        'p',
        { class: 'card__note' },
        active
          ? `Custom meals stay on the plan. Recipes add ingredients to ${active.name}.`
          : 'Custom meals stay on the plan. Create a grocery list to add recipe ingredients.'
      )
    );

    refs.dialogBody.replaceChildren(...nodes);
    renderRecipeOptions();
  }

  function renderRecipeOptions() {
    const listNode = refs.dialogBody.querySelector('#plan-recipe-list');
    if (!listNode) return;

    const query = (refs.dialogBody.querySelector('#plan-recipe-search')?.value || '')
      .trim()
      .toLowerCase();
    const allRecipes = store.visibleRecipes();
    const recipes = allRecipes.filter((recipe) => {
      if (!query) return true;
      const haystack = [
        recipe.title,
        recipe.category,
        ...recipe.ingredients.map((ingredient) => ingredient.name),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });

    if (!recipes.length) {
      listNode.replaceChildren(
        h(
          'p',
          { class: 'plan-recipe-empty' },
          allRecipes.length ? 'No recipes match that search.' : 'No recipes saved yet.'
        )
      );
      return;
    }

    listNode.replaceChildren(
      ...recipes.map((recipe) =>
        h(
          'button',
          {
            class: 'recipe-card plan-recipe-card',
            type: 'button',
            dataset: { action: 'pick-recipe', recipeId: recipe.id },
            'aria-label': `Plan ${recipe.title}`,
          },
          h(
            'span',
            { class: 'recipe-card__body' },
            h('span', { class: 'recipe-card__title' }, recipe.title),
            h(
              'span',
              { class: 'recipe-card__meta' },
              `${recipe.category} · ${countLabel(
                recipe.ingredients.length,
                'ingredient'
              )} · makes ${recipe.servings}`
            )
          ),
          h('span', { class: 'recipe-card__chevron' }, icon('chevron'))
        )
      )
    );
  }

  function setStatus(message) {
    refs.dialogStatus.textContent = message;
  }

  function planToast(result, verb = 'Planned') {
    const date = fromDateKey(result.entry.date);
    const day = date ? WEEKDAY.format(date) : 'that day';
    let message = `${verb} ${day} ${PLAN_SLOT_LABELS[result.entry.slot].toLowerCase()}`;

    if (result.added) {
      message += ` · added ${countLabel(result.added, 'ingredient')} to ${result.list.name}`;
    }
    if (result.skipped) {
      message += ` · kept ${countLabel(result.skipped, 'checked item')}`;
    } else if (!result.added && result.recipe.ingredients.length) {
      message += ' · checked items kept';
    }

    return `${message}.`;
  }

  function pickRecipe(recipeId) {
    const recipe = store.getRecipe(recipeId);
    const active = store.getActiveList();
    if (!recipe) return;

    if (!active) {
      setStatus('Create a grocery list first.');
      return;
    }

    const result = store.addRecipeToPlan({
      date: selectedDate,
      slot: selectedSlot,
      recipeId: recipe.id,
      servings: recipe.servings,
      listId: active.id,
    });

    if (!result) {
      setStatus('Could not add that recipe to the plan.');
      return;
    }

    planSheet.close();
    renderWeek();
    showToast(planToast(result));
  }

  function updatePlan() {
    const entry = store.getPlanEntry(selectedDate, selectedSlot);
    if (!entry || !entry.recipeId) return;

    const active = store.getActiveList();
    if (!active) {
      setStatus('Create a grocery list first.');
      return;
    }

    const input = refs.dialogBody.querySelector('#plan-servings');
    const servings = clampServings(input ? input.value : entry.servings);
    const result = store.addRecipeToPlan({
      date: selectedDate,
      slot: selectedSlot,
      recipeId: entry.recipeId,
      servings,
      listId: active.id,
    });

    if (!result) {
      setStatus('That recipe is no longer available.');
      return;
    }

    planSheet.close();
    renderWeek();
    showToast(planToast(result, 'Updated'));
  }

  function saveCustom() {
    const input = refs.dialogBody.querySelector('#plan-custom-name');
    const title = (input ? input.value : '').trim();
    if (!title) {
      setStatus('Name the meal first.');
      if (input) input.focus();
      return;
    }

    const result = store.setPlanMeal({
      date: selectedDate,
      slot: selectedSlot,
      title,
      servings: 1,
    });

    if (!result) {
      setStatus('Could not save that meal.');
      return;
    }

    const date = fromDateKey(selectedDate);
    const day = date ? WEEKDAY.format(date) : 'that day';
    planSheet.close();
    renderWeek();
    showToast(
      result.removed
        ? `Saved ${title} for ${day} · removed ${countLabel(result.removed, 'list item')}.`
        : `Saved ${title} for ${day}.`
    );
  }

  function handleCustomSubmit(event) {
    event.preventDefault();
    saveCustom();
  }

  function removePlan() {
    const entry = store.getPlanEntry(selectedDate, selectedSlot);
    if (!entry) return;

    const recipe = entry.recipeId ? store.getRecipe(entry.recipeId) : null;
    const title = recipe ? recipe.title : entry.title;
    const date = fromDateKey(selectedDate);
    const day = date ? WEEKDAY.format(date) : 'that day';

    if (
      !window.confirm(
        `Remove “${title}” from ${day}? Unchecked ingredients added by this meal will be removed.`
      )
    ) {
      return;
    }

    const result = store.clearPlanEntry(selectedDate, selectedSlot);
    if (!result) return;

    planSheet.close();
    renderWeek();
    showToast(
      result.removed
        ? `Removed ${title} · removed ${countLabel(result.removed, 'list item')}.`
        : `Removed ${title}.`
    );
  }

  function clearDay(dateKey) {
    const entries = store.getPlanEntriesInDate(dateKey);
    if (!entries.length) return;

    const date = fromDateKey(dateKey);
    if (
      !window.confirm(
        `Clear ${WEEKDAY.format(date)}? Unchecked ingredients added by these meals will be removed.`
      )
    ) {
      return;
    }

    const result = store.clearPlanDay(dateKey);
    renderWeek();
    showToast(
      result.removed
        ? `Cleared ${countLabel(result.cleared, 'meal')} · removed ${countLabel(
            result.removed,
            'list item'
          )}.`
        : `Cleared ${countLabel(result.cleared, 'meal')}.`
    );
  }

  function copyLastWeek() {
    const sourceStart = addDays(anchor, -7);
    const source = store.getPlanEntriesInRange(
      toDateKey(sourceStart),
      toDateKey(addDays(sourceStart, 6))
    );

    if (!source.length) {
      showToast('Last week has no meals to copy.');
      return;
    }

    const occupied = new Set(weekEntries().map((entry) => `${entry.date}:${entry.slot}`));
    const active = store.getActiveList();
    let copied = 0;
    let added = 0;
    let skipped = 0;

    for (const entry of source) {
      const targetDate = toDateKey(addDays(fromDateKey(entry.date), 7));
      const key = `${targetDate}:${entry.slot}`;
      if (occupied.has(key)) continue;

      let result = null;
      if (entry.recipeId) {
        result = store.addRecipeToPlan({
          date: targetDate,
          slot: entry.slot,
          recipeId: entry.recipeId,
          servings: entry.servings,
          listId: active ? active.id : null,
        });
      }

      if (!result) {
        result = store.setPlanMeal({
          date: targetDate,
          slot: entry.slot,
          title: entry.title,
          servings: entry.servings,
        });
      }

      if (!result) continue;
      copied += 1;
      if (result.added) added += result.added;
      if (result.skipped) skipped += result.skipped;
      occupied.add(key);
    }

    renderWeek();

    if (!copied) {
      showToast('Last week’s meals are already on this week.');
      return;
    }

    let message = `Copied ${countLabel(copied, 'meal')}`;
    if (added) {
      message += ` · added ${countLabel(added, 'ingredient')} to ${
        active ? active.name : 'your list'
      }`;
    }
    if (skipped) message += ` · kept ${countLabel(skipped, 'checked item')}`;
    showToast(`${message}.`);
  }

  refs.prev.addEventListener('click', () => {
    anchor = addDays(anchor, -7);
    renderWeek();
  });

  refs.next.addEventListener('click', () => {
    anchor = addDays(anchor, 7);
    renderWeek();
  });

  refs.today.addEventListener('click', () => {
    anchor = startOfWeek(new Date(), weekStart);
    renderWeek();
  });

  refs.targetList.addEventListener('change', () => {
    store.setActiveList(refs.targetList.value);
    renderTarget();
  });

  refs.copy.addEventListener('click', copyLastWeek);

  refs.week.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    if (button.dataset.action === 'slot') {
      openSlot(button.dataset.planDate, button.dataset.planSlot, button);
    } else if (button.dataset.action === 'clear-day') {
      clearDay(button.dataset.date);
    }
  });

  refs.dialogClose.addEventListener('click', () => planSheet.close());

  refs.dialogBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    if (action === 'servings-down' || action === 'servings-up') {
      const input = refs.dialogBody.querySelector('#plan-servings');
      if (!input) return;
      input.value = String(
        clampServings(Number(input.value || 1) + (action === 'servings-up' ? 1 : -1))
      );
      return;
    }

    if (action === 'update-plan') updatePlan();
    else if (action === 'pick-recipe') pickRecipe(button.dataset.recipeId);
    else if (action === 'change-recipe') {
      planMode = 'pick';
      renderDialog();
      requestAnimationFrame(() => refs.dialogBody.querySelector('#plan-recipe-search')?.focus());
    } else if (action === 'back-to-edit') {
      planMode = 'edit';
      renderDialog();
    } else if (action === 'save-custom') saveCustom();
    else if (action === 'remove-plan') removePlan();
  });

  refs.dialogBody.addEventListener('input', (event) => {
    if (event.target.id === 'plan-recipe-search') renderRecipeOptions();
  });

  refs.dialogBody.addEventListener('keydown', (event) => {
    if (event.target.id !== 'plan-servings' || event.key !== 'Enter') return;
    event.preventDefault();
    updatePlan();
  });

  renderTarget();
  renderWeek();

  return () => {
    planSheet.destroy();
  };
}
