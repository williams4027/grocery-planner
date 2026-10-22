/* Recipes — seeded browser, search, detail, and add-to-list. */

import { RECIPE_CATEGORIES } from '../config.js';
import * as store from '../store.js';
import { createSheetController } from '../sheet.js';
import { formatQuantity, h, icon, ICONS, showToast } from '../ui.js';

const FILTERS = ['All', ...RECIPE_CATEGORIES];

export function mount(root) {
  let query = '';
  let category = 'All';
  let selectedRecipeId = null;
  let lastRecipeTrigger = null;
  let editingRecipeId = null;
  let lastFormTrigger = null;

  root.innerHTML = `
    <header class="page-head">
      <div class="page-head__text">
        <h1 class="page-title">Recipes</h1>
        <p class="list-count" id="recipe-count" aria-live="polite"></p>
      </div>
      <div class="page-head__actions">
        <button
          class="icon-btn"
          id="new-recipe-btn"
          type="button"
          aria-label="New recipe"
          title="New recipe"
          aria-haspopup="dialog"
          aria-controls="recipe-form-dialog"
        >
          ${ICONS.plus}
        </button>
      </div>
    </header>

    <p class="lede">Saved meals with ingredients ready to drop onto your active grocery list.</p>

    <div class="recipe-tools">
      <label class="sr-only" for="recipe-search">Search recipes</label>
      <input
        id="recipe-search"
        class="recipe-search"
        type="search"
        placeholder="Search recipes or ingredients"
        autocomplete="off"
        enterkeyhint="search"
      />
      <div
        id="recipe-filters"
        class="filter-chips"
        role="group"
        aria-label="Filter recipes by meal"
      ></div>
    </div>

    <div id="recipe-list" class="recipe-list"></div>

    <dialog id="recipe-detail-dialog" class="sheet recipe-sheet" aria-labelledby="recipe-detail-title">
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head">
        <h2 id="recipe-detail-title">Recipe</h2>
        <button class="sheet__close" id="recipe-detail-close" type="button" aria-label="Close">
          ${ICONS.close}
        </button>
      </div>
      <div id="recipe-detail-body" class="recipe-detail"></div>
      <p id="recipe-detail-status" class="sheet__status" role="status" aria-live="polite"></p>
    </dialog>

    <dialog id="recipe-form-dialog" class="sheet" aria-labelledby="recipe-form-title">
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head">
        <h2 id="recipe-form-title">New recipe</h2>
        <button class="sheet__close" id="recipe-form-close" type="button" aria-label="Close">
          ${ICONS.close}
        </button>
      </div>

      <form id="recipe-form" class="new-list recipe-form" autocomplete="off" novalidate>
        <label class="field field--stacked">
          <span class="field__label">Recipe name</span>
          <input
            id="recipe-name"
            class="add__name"
            name="title"
            type="text"
            maxlength="100"
            placeholder="e.g. Weeknight tacos"
            enterkeyhint="next"
            autocapitalize="sentences"
            required
          />
        </label>

        <label class="field field--stacked">
          <span class="field__label">Category</span>
          <select id="recipe-category" class="field__input" name="category">
            ${RECIPE_CATEGORIES.map(
              (value) =>
                `<option value="${value}"${value === 'Lunch/Dinner' ? ' selected' : ''}>${value}</option>`
            ).join('')}
          </select>
        </label>

        <label class="field field--stacked">
          <span class="field__label">Ingredients</span>
          <textarea
            id="recipe-ingredients"
            class="recipe-textarea"
            name="ingredients"
            rows="7"
            placeholder="One ingredient per line, e.g. 2 cups chopped carrots"
            required
          ></textarea>
        </label>

        <p class="recipe-form__note">
          Quantities at the start of a line are pulled out automatically. Lines without a unit stay
          as written.
        </p>

        <button id="recipe-form-submit" class="btn btn--primary new-list__submit" type="submit">
          Save recipe
        </button>
      </form>

      <p id="recipe-form-status" class="sheet__status" role="status" aria-live="polite"></p>
    </dialog>
  `;

  const refs = {
    count: root.querySelector('#recipe-count'),
    search: root.querySelector('#recipe-search'),
    filters: root.querySelector('#recipe-filters'),
    list: root.querySelector('#recipe-list'),
    newButton: root.querySelector('#new-recipe-btn'),
    detailDialog: root.querySelector('#recipe-detail-dialog'),
    detailTitle: root.querySelector('#recipe-detail-title'),
    detailBody: root.querySelector('#recipe-detail-body'),
    detailStatus: root.querySelector('#recipe-detail-status'),
    detailClose: root.querySelector('#recipe-detail-close'),
    formDialog: root.querySelector('#recipe-form-dialog'),
    formTitle: root.querySelector('#recipe-form-title'),
    form: root.querySelector('#recipe-form'),
    nameInput: root.querySelector('#recipe-name'),
    categoryInput: root.querySelector('#recipe-category'),
    ingredientsInput: root.querySelector('#recipe-ingredients'),
    formSubmit: root.querySelector('#recipe-form-submit'),
    formStatus: root.querySelector('#recipe-form-status'),
    formClose: root.querySelector('#recipe-form-close'),
  };

  const detailSheet = createSheetController(refs.detailDialog, {
    trigger: () =>
      lastRecipeTrigger && lastRecipeTrigger.isConnected ? lastRecipeTrigger : refs.newButton,
    initialFocus: () => refs.detailClose,
    onOpen: populateDetail,
    onClose: () => {
      refs.detailStatus.textContent = '';
    },
  });

  function ingredientLine(ingredient) {
    const quantity = formatQuantity(ingredient);
    return [quantity, ingredient.name].filter(Boolean).join(' ');
  }

  function prepareRecipeForm() {
    refs.formStatus.textContent = '';

    if (editingRecipeId) {
      const recipe = store.getRecipe(editingRecipeId);
      if (recipe) {
        refs.formTitle.textContent = 'Edit recipe';
        refs.formSubmit.textContent = 'Save changes';
        refs.nameInput.value = recipe.title;
        refs.categoryInput.value = recipe.category;
        refs.ingredientsInput.value = recipe.ingredients
          .map(ingredientLine)
          .join('\n');
        return;
      }

      editingRecipeId = null;
      refs.form.reset();
    }

    refs.formTitle.textContent = 'New recipe';
    refs.formSubmit.textContent = 'Save recipe';
  }

  function resetRecipeFormMode() {
    if (!editingRecipeId) return;

    editingRecipeId = null;
    refs.form.reset();
    refs.formTitle.textContent = 'New recipe';
    refs.formSubmit.textContent = 'Save recipe';
  }

  function openRecipeForm({ recipeId = null, trigger = refs.newButton } = {}) {
    editingRecipeId = recipeId;
    lastFormTrigger = trigger;
    formSheet.open();
  }

  const formSheet = createSheetController(refs.formDialog, {
    trigger: () =>
      lastFormTrigger && lastFormTrigger.isConnected ? lastFormTrigger : refs.newButton,
    initialFocus: () => refs.nameInput,
    selectOnOpen: true,
    onOpen: prepareRecipeForm,
    onClose: () => {
      resetRecipeFormMode();
      refs.formStatus.textContent = '';
    },
  });

  function renderFilters() {
    refs.filters.replaceChildren(
      ...FILTERS.map((value) =>
        h(
          'button',
          {
            class: `filter-chip${category === value ? ' is-active' : ''}`,
            type: 'button',
            dataset: { category: value },
            'aria-pressed': category === value ? 'true' : 'false',
          },
          value
        )
      )
    );
  }

  function updateFilterChips() {
    for (const chip of refs.filters.querySelectorAll('button[data-category]')) {
      const active = chip.dataset.category === category;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function renderList() {
    const allRecipes = store.visibleRecipes();
    const recipes = allRecipes.filter(matchesFilters);

    if (!allRecipes.length) {
      refs.count.textContent = 'No recipes yet';
    } else if (recipes.length === allRecipes.length) {
      refs.count.textContent = `${allRecipes.length} recipe${allRecipes.length === 1 ? '' : 's'}`;
    } else {
      refs.count.textContent = `${recipes.length} of ${allRecipes.length} recipes`;
    }

    if (!recipes.length) {
      const hasFilters = Boolean(query) || category !== 'All';
      refs.list.replaceChildren(
        h(
          'section',
          { class: 'card empty' },
          h('div', { class: 'empty__icon' }, icon('recipes')),
          h('h2', {}, hasFilters ? 'No recipes match' : 'No recipes yet'),
          h(
            'p',
            {},
            hasFilters
              ? 'Try a different search or category.'
              : 'Save a meal with its ingredients, then add them to any grocery list.'
          ),
          h(
            'button',
            {
              class: 'btn',
              type: 'button',
              dataset: { action: hasFilters ? 'clear' : 'new' },
            },
            hasFilters ? 'Clear filters' : 'Add a recipe'
          )
        )
      );
      return;
    }

    refs.list.replaceChildren(
      ...recipes.map((recipe) => {
        const ingredientCount = recipe.ingredients.length;
        return h(
          'button',
          {
            class: 'recipe-card',
            type: 'button',
            dataset: { recipeId: recipe.id },
            'aria-label': `Open ${recipe.title}`,
          },
          h(
            'span',
            { class: 'recipe-card__body' },
            h('span', { class: 'recipe-card__title' }, recipe.title),
            h(
              'span',
              { class: 'recipe-card__meta' },
              `${recipe.category} · ${ingredientCount} ingredient${
                ingredientCount === 1 ? '' : 's'
              }`
            )
          ),
          h('span', { class: 'recipe-card__chevron' }, icon('chevron'))
        );
      })
    );
  }

  function matchesFilters(recipe) {
    if (category !== 'All' && recipe.category !== category) return false;
    if (!query) return true;

    const haystack = [
      recipe.title,
      recipe.category,
      ...recipe.ingredients.map((ingredient) => ingredient.name),
    ]
      .join(' ')
      .toLowerCase();

    return haystack.includes(query);
  }

  function clearFilters() {
    query = '';
    category = 'All';
    refs.search.value = '';
    updateFilterChips();
    renderList();
    refs.search.focus({ preventScroll: true });
  }

  function openDetail(recipeId, trigger) {
    selectedRecipeId = recipeId;
    lastRecipeTrigger = trigger || null;
    detailSheet.open();
  }

  function populateDetail() {
    const recipe = store.getRecipe(selectedRecipeId);
    if (!recipe) {
      detailSheet.close();
      return;
    }

    const lists = store.visibleLists();
    const list = store.getActiveList();
    const ingredientCount = recipe.ingredients.length;

    const ingredientNodes = recipe.ingredients.length
      ? recipe.ingredients.map((ingredient) => {
          const quantity = formatQuantity(ingredient);
          return h(
            'li',
            { class: 'recipe-ingredient' },
            h('span', { class: 'recipe-ingredient__name' }, ingredient.name),
            quantity
              ? h('span', { class: 'recipe-ingredient__qty' }, quantity)
              : null
          );
        })
      : [h('li', { class: 'recipe-ingredient' }, 'No ingredients saved yet.')];

    refs.detailTitle.textContent = recipe.title;
    refs.detailStatus.textContent = '';
    refs.detailBody.replaceChildren(
      h('p', { class: 'recipe-detail__meta' }, recipe.category),
      h(
        'ul',
        { class: 'recipe-ingredients', 'aria-label': `${recipe.title} ingredients` },
        ingredientNodes
      ),
      lists.length > 1
        ? h(
            'label',
            { class: 'field field--stacked recipe-target' },
            h('span', { class: 'field__label' }, 'Add to'),
            h(
              'select',
              { class: 'field__input', id: 'recipe-target-list' },
              ...lists.map((entry) =>
                h(
                  'option',
                  {
                    value: entry.id,
                    selected: Boolean(list && entry.id === list.id),
                  },
                  entry.name
                )
              )
            )
          )
        : list
          ? h('p', { class: 'recipe-detail__to' }, 'Adds to ', h('strong', {}, list.name))
          : h('p', { class: 'recipe-detail__to' }, 'Create a grocery list first.'),
      h(
        'div',
        { class: 'recipe-actions' },
        h(
          'button',
          {
            class: 'btn btn--primary recipe-add',
            type: 'button',
            dataset: { action: 'add-recipe' },
            disabled: !ingredientCount || !list,
          },
          ingredientCount
            ? `Add ${ingredientCount} ingredient${ingredientCount === 1 ? '' : 's'}`
            : 'Nothing to add'
        ),
        h(
          'button',
          {
            class: 'btn recipe-edit',
            type: 'button',
            dataset: { action: 'edit-recipe' },
          },
          'Edit recipe'
        ),
        h(
          'button',
          {
            class: 'recipe-remove',
            type: 'button',
            dataset: { action: 'delete-recipe' },
          },
          'Delete recipe'
        )
      )
    );
  }

  refs.search.addEventListener('input', () => {
    query = refs.search.value.trim().toLowerCase();
    renderList();
  });

  refs.filters.addEventListener('click', (event) => {
    const chip = event.target.closest('button[data-category]');
    if (!chip || chip.dataset.category === category) return;

    category = chip.dataset.category;
    updateFilterChips();
    renderList();
  });

  refs.list.addEventListener('click', (event) => {
    const card = event.target.closest('button[data-recipe-id]');
    if (card) {
      openDetail(card.dataset.recipeId, card);
      return;
    }

    const action = event.target.closest('button[data-action]');
    if (!action) return;

    if (action.dataset.action === 'new') openRecipeForm({ trigger: action });
    else if (action.dataset.action === 'clear') clearFilters();
  });

  refs.detailClose.addEventListener('click', () => detailSheet.close());

  refs.detailBody.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    if (button.dataset.action === 'add-recipe') {
      const recipe = store.getRecipe(selectedRecipeId);
      const lists = store.visibleLists();
      const selectedList = refs.detailBody.querySelector('#recipe-target-list');
      const targetList = selectedList
        ? lists.find((entry) => entry.id === selectedList.value)
        : store.getActiveList();
      if (!recipe || !targetList) return;

      const count = store.addRecipeToList(recipe.id, targetList.id);
      if (!count) {
        refs.detailStatus.textContent = 'There are no ingredients to add.';
        return;
      }

      if (store.getState().settings.activeListId !== targetList.id) {
        store.setActiveList(targetList.id);
      }

      detailSheet.close();
      showToast(
        `Added ${count} ingredient${count === 1 ? '' : 's'} to ${targetList.name}.`
      );
      return;
    }

    if (button.dataset.action === 'edit-recipe') {
      const recipe = store.getRecipe(selectedRecipeId);
      if (!recipe) return;

      const trigger = lastRecipeTrigger;
      detailSheet.close();
      setTimeout(() => {
        openRecipeForm({
          recipeId: recipe.id,
          trigger: trigger && trigger.isConnected ? trigger : refs.newButton,
        });
      }, 0);
      return;
    }

    if (button.dataset.action === 'delete-recipe') {
      const recipe = store.getRecipe(selectedRecipeId);
      if (!recipe) return;
      if (!window.confirm(`Remove “${recipe.title}”?`)) return;

      store.deleteRecipe(recipe.id);
      selectedRecipeId = null;
      detailSheet.close();
      renderList();
      showToast('Recipe removed.');
    }
  });

  refs.newButton.addEventListener('click', () => openRecipeForm());
  refs.formClose.addEventListener('click', () => formSheet.close());

  refs.form.addEventListener('submit', (event) => {
    event.preventDefault();

    const title = refs.nameInput.value.trim();
    if (!title) {
      refs.formStatus.textContent = 'Give the recipe a name.';
      refs.nameInput.focus();
      return;
    }

    const ingredients = refs.ingredientsInput.value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    if (!ingredients.length) {
      refs.formStatus.textContent = 'Add at least one ingredient.';
      refs.ingredientsInput.focus();
      return;
    }

    if (editingRecipeId) {
      const recipe = store.updateRecipe(editingRecipeId, {
        title,
        category: refs.categoryInput.value,
        ingredients,
      });

      if (!recipe) {
        refs.formStatus.textContent = 'Could not save that recipe.';
        return;
      }

      renderList();
      formSheet.close();
      showToast('Recipe updated.');
      return;
    }

    const recipe = store.addRecipe({
      title,
      category: refs.categoryInput.value,
      ingredients,
    });

    if (!recipe) {
      refs.formStatus.textContent = 'Could not save that recipe.';
      return;
    }

    refs.form.reset();
    query = '';
    category = 'All';
    refs.search.value = '';
    updateFilterChips();
    renderList();
    formSheet.close();
    showToast(`${recipe.title} saved.`);
  });

  renderFilters();
  renderList();

  return () => {
    detailSheet.destroy();
    formSheet.destroy();
  };
}
