/* Meal plan — one continuous meal list that feeds the active grocery list. */

import * as store from '../store.js';
import { createSheetController } from '../sheet.js';
import { h, icon, ICONS, showCheer, showToast } from '../ui.js';

function countLabel(count, singular, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function mount(root) {
  let selectedEntryId = null;
  let selectedTrigger = null;
  let planMode = 'pick';

  root.innerHTML = `
    <header class="page-head">
      <div class="page-head__text">
        <h1 class="page-title">Meal plan</h1>
        <p class="list-count" id="plan-count" aria-live="polite"></p>
      </div>
      <div class="page-head__actions">
        <button class="ghost-btn" id="plan-clear" type="button">Clear</button>
      </div>
    </header>

    <p class="lede">
      Pick meals as you plan the week. Their ingredients go straight to the list you’ll shop from.
    </p>

    <section class="card plan-card" aria-labelledby="meals-title">
      <div class="card__head plan-card__head">
        <div class="plan-heading">
          <h2 id="meals-title">Meals</h2>
          <p class="plan-heading__note">A running list for the next shopping trip.</p>
        </div>
        <button class="btn btn--primary plan-add-btn" id="plan-add" type="button">
          ${ICONS.plus} Add meal
        </button>
      </div>

      <div class="plan-target">
        <label class="field field--stacked">
          <span class="field__label">Add ingredients to</span>
          <select id="plan-target-list" class="field__input"></select>
        </label>
        <p id="plan-target-note" class="card__note"></p>
      </div>

      <div id="plan-list" class="plan-list"></div>

      <p class="card__note plan-list__note">
        Tap a meal to swap the recipe or remove it. Removing a meal removes only its unchecked
        ingredients.
      </p>
    </section>

    <dialog id="plan-dialog" class="sheet plan-sheet" aria-labelledby="plan-dialog-title">
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head">
        <h2 id="plan-dialog-title">Add a meal</h2>
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
    clear: root.querySelector('#plan-clear'),
    add: root.querySelector('#plan-add'),
    targetList: root.querySelector('#plan-target-list'),
    targetNote: root.querySelector('#plan-target-note'),
    list: root.querySelector('#plan-list'),
    dialog: root.querySelector('#plan-dialog'),
    dialogTitle: root.querySelector('#plan-dialog-title'),
    dialogContext: root.querySelector('#plan-dialog-context'),
    dialogBody: root.querySelector('#plan-dialog-body'),
    dialogStatus: root.querySelector('#plan-dialog-status'),
    dialogClose: root.querySelector('#plan-dialog-close'),
  };

  const planSheet = createSheetController(refs.dialog, {
    trigger: () => {
      if (selectedEntryId) {
        const next = root.querySelector(
          `[data-action="edit"][data-entry-id="${selectedEntryId}"]`
        );
        if (next) return next;
      }
      return selectedTrigger && selectedTrigger.isConnected ? selectedTrigger : refs.add;
    },
    initialFocus: () =>
      refs.dialogBody.querySelector('#plan-recipe-search') ||
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

  function emptyState() {
    return h(
      'div',
      { class: 'plan-empty' },
      h('p', { class: 'plan-empty__title' }, 'No meals planned yet'),
      h(
        'p',
        { class: 'plan-empty__note' },
        'Pick a recipe and its ingredients will be added to your grocery list.'
      ),
      h(
        'button',
        {
          class: 'btn btn--primary',
          type: 'button',
          dataset: { action: 'add' },
        },
        'Add your first meal'
      )
    );
  }

  function mealNode(entry) {
    const recipe = entry.recipeId ? store.getRecipe(entry.recipeId) : null;
    const title = recipe ? recipe.title : entry.title;
    let meta = 'Custom meal';

    if (recipe) {
      meta = `${recipe.category} · ${countLabel(
        recipe.ingredients.length,
        'ingredient'
      )} · ${countLabel(entry.servings, 'serving')}`;
    } else if (entry.recipeId) {
      meta = 'Recipe removed';
    }

    return h(
      'button',
      {
        class: 'plan-meal',
        type: 'button',
        dataset: { action: 'edit', entryId: entry.id },
        'aria-label': `Edit planned meal: ${title}`,
      },
      h(
        'span',
        { class: 'plan-meal__body' },
        h('span', { class: 'plan-meal__title' }, title),
        h(
          'span',
          {
            class: `plan-meal__meta${
              entry.recipeId && !recipe ? ' plan-meal__meta--warn' : ''
            }`,
          },
          meta
        )
      ),
      h('span', { class: 'plan-meal__action', 'aria-hidden': 'true' }, icon('chevron'))
    );
  }

  function renderPlan() {
    const entries = store.getPlanEntries();

    refs.count.textContent = entries.length
      ? `${countLabel(entries.length, 'meal')} planned`
      : 'Nothing planned yet';
    refs.clear.disabled = !entries.length;
    refs.list.replaceChildren(
      ...(entries.length ? entries.map(mealNode) : [emptyState()])
    );
  }

  function openPicker(trigger) {
    selectedEntryId = null;
    selectedTrigger = trigger || null;
    planMode = 'pick';
    refs.dialogStatus.textContent = '';
    renderDialog();
    planSheet.open();
  }

  function openEdit(entryId, trigger) {
    selectedEntryId = entryId;
    selectedTrigger = trigger || null;
    planMode = 'edit';
    refs.dialogStatus.textContent = '';
    renderDialog();
    planSheet.open();
  }

  function renderDialog() {
    const entry = selectedEntryId ? store.getPlanEntry(selectedEntryId) : null;

    if (planMode === 'edit' && entry) {
      refs.dialogTitle.textContent = 'Edit meal';
      refs.dialogContext.textContent = entry.recipeId
        ? 'Swap the recipe or remove this meal.'
        : 'Rename or remove this meal.';
      renderEdit(entry);
      return;
    }

    refs.dialogTitle.textContent = entry ? 'Change meal' : 'Add a meal';
    refs.dialogContext.textContent = entry
      ? 'Pick a replacement recipe or type a meal.'
      : 'Pick a recipe or type your own meal.';
    renderPicker(entry);
  }

  function renderEdit(entry) {
    const recipe = entry.recipeId ? store.getRecipe(entry.recipeId) : null;
    const active = store.getActiveList();
    const title = recipe ? recipe.title : entry.title;
    const meta = recipe
      ? `${recipe.category} · ${countLabel(recipe.ingredients.length, 'ingredient')}`
      : entry.recipeId
        ? 'Recipe removed'
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
          { class: 'plan-actions' },
          h(
            'button',
            {
              class: 'btn btn--primary',
              type: 'button',
              dataset: { action: 'update-plan' },
            },
            'Update ingredients'
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
          ? `Custom meals stay on the list. Recipes add ingredients to ${active.name}.`
          : 'Custom meals stay on the list. Create a grocery list to add recipe ingredients.'
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

  function planToast(result, verb = 'Added') {
    const title = result.recipe ? result.recipe.title : result.entry.title;
    let message = `${verb} ${title}`;

    if (result.added) {
      message += ` · added ${countLabel(result.added, 'ingredient')} to ${result.list.name}`;
    }
    if (result.skipped) {
      message += ` · kept ${countLabel(result.skipped, 'checked item')}`;
    } else if (!result.added && result.recipe && result.recipe.ingredients.length) {
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

    const result = selectedEntryId
      ? store.updatePlanRecipe({
          entryId: selectedEntryId,
          recipeId: recipe.id,
          servings: recipe.servings,
          listId: active.id,
        })
      : store.addRecipeToPlan({
          recipeId: recipe.id,
          servings: recipe.servings,
          listId: active.id,
        });

    if (!result) {
      setStatus('Could not add that meal.');
      return;
    }

    planSheet.close();
    renderPlan();
    showCheer('recipe', planToast(result));
  }

  function updatePlan() {
    const entry = selectedEntryId ? store.getPlanEntry(selectedEntryId) : null;
    if (!entry || !entry.recipeId) return;

    const active = store.getActiveList();
    if (!active) {
      setStatus('Create a grocery list first.');
      return;
    }

    const result = store.updatePlanRecipe({
      entryId: entry.id,
      recipeId: entry.recipeId,
      servings: entry.servings,
      listId: active.id,
    });

    if (!result) {
      setStatus('That recipe is no longer available.');
      return;
    }

    planSheet.close();
    renderPlan();
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

    const existing = selectedEntryId ? store.getPlanEntry(selectedEntryId) : null;
    const result = existing
      ? store.updatePlanMeal({ entryId: existing.id, title, servings: 1 })
      : store.addPlanMeal({ title, servings: 1 });

    if (!result) {
      setStatus('Could not save that meal.');
      return;
    }

    planSheet.close();
    renderPlan();
    showToast(
      result.removed
        ? `Saved ${title} · removed ${countLabel(result.removed, 'list item')}.`
        : `Saved ${title}.`
    );
  }

  function handleCustomSubmit(event) {
    event.preventDefault();
    saveCustom();
  }

  function removePlan() {
    const entry = selectedEntryId ? store.getPlanEntry(selectedEntryId) : null;
    if (!entry) return;

    const recipe = entry.recipeId ? store.getRecipe(entry.recipeId) : null;
    const title = recipe ? recipe.title : entry.title;

    if (
      !window.confirm(
        `Remove “${title}” from the meal list? Unchecked ingredients added by this meal will be removed.`
      )
    ) {
      return;
    }

    const result = store.removePlanEntry(entry.id);
    if (!result) return;

    planSheet.close();
    renderPlan();
    showToast(
      result.removed
        ? `Removed ${title} · removed ${countLabel(result.removed, 'list item')}.`
        : `Removed ${title}.`
    );
  }

  function clearPlan() {
    if (!store.getPlanEntries().length) return;

    if (
      !window.confirm(
        'Clear all planned meals? Ingredients already on your grocery list will stay.'
      )
    ) {
      return;
    }

    const result = store.clearPlan();
    renderPlan();
    showToast(
      result.cleared
        ? `Cleared ${countLabel(result.cleared, 'meal')}.`
        : 'Meal list cleared.'
    );
  }

  refs.add.addEventListener('click', () => openPicker(refs.add));
  refs.clear.addEventListener('click', clearPlan);

  refs.targetList.addEventListener('change', () => {
    store.setActiveList(refs.targetList.value);
    renderTarget();
  });

  refs.list.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    if (button.dataset.action === 'edit') {
      openEdit(button.dataset.entryId, button);
    } else if (button.dataset.action === 'add') {
      openPicker(button);
    }
  });

  refs.dialogClose.addEventListener('click', () => planSheet.close());

  refs.dialogBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
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

  renderTarget();
  renderPlan();

  return () => {
    planSheet.destroy();
  };
}
