/* State container + persistence.
 *
 * One state document is kept in IndexedDB (localStorage fallback), written
 * with a short debounce. Every mutation notifies subscribers synchronously.
 */

import { AISLES, RECIPE_CATEGORIES, STORAGE } from './config.js';
import { createBackup as buildBackup, parseBackup, readBackup } from './backup.js';
import {
  createEmptyState,
  createItem,
  createList,
  createRecipe,
  normalizeAisleOrder,
  normalizePlanEntry,
  normalizeQty,
  normalizeServings,
  normalizeState,
  nowIso,
  suggestAisle,
  summarizeState,
} from './model.js';
import { RECIPE_SEED_VERSION, SEED_RECIPES } from './seed-recipes.js';

let state = createEmptyState();
let ready = false;
let storageMode = 'memory';
let loadError = '';
let saveError = '';
let database = null;

const listeners = new Set();
const RECIPE_CATEGORY_ORDER = new Map(
  RECIPE_CATEGORIES.map((category, index) => [category, index])
);
const ITEM_MERGE_VERSION = 2;
let saveTimer = null;
let saveChain = Promise.resolve();

/* ---------- Public API ---------- */

export async function init() {
  if (ready) return state;

  let raw = null;

  try {
    database = await openDatabase();
    storageMode = 'indexeddb';
    raw = await idbGet(database, STORAGE.stateKey);
  } catch (error) {
    console.warn('IndexedDB unavailable; trying localStorage.', error);
    database = null;
  }

  if (raw === null || raw === undefined) {
    try {
      const stored = localStorage.getItem(STORAGE.localStorageKey);
      if (stored) {
        raw = stored;
        if (!database) storageMode = 'localstorage';
      }
    } catch (error) {
      console.warn('localStorage read failed.', error);
    }
  }

  if (!database && storageMode !== 'localstorage') {
    storageMode = localStorageWorks() ? 'localstorage' : 'memory';
  }

  if (storageMode === 'memory') {
    saveError = 'This browser is blocking storage, so changes will be lost when the tab closes.';
  }

  if (raw !== null && raw !== undefined) {
    try {
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      state = normalizeState(parsed);
    } catch (error) {
      console.error('Could not read saved data.', error);

      if (error && String(error.message).includes('newer version')) {
        // Do not overwrite data we cannot understand; make the user update first.
        storageMode = 'memory';
        loadError =
          'Saved data was created by a newer version of this app. Reload to update before making changes.';
      } else {
        const preserved = preserveUnreadableData(raw);
        loadError = preserved
          ? 'Saved data could not be read, so a fresh list was started. The unreadable copy was kept on this device.'
          : 'Saved data could not be read, so a fresh list was started.';
      }

      state = createEmptyState();
    }
  }

  ensureRecipeSeed();
  ensureListDedupe();
  ensureRecipeOrder();
  ready = true;
  notify();
  scheduleSave();

  if (storageMode === 'indexeddb' && navigator.storage && navigator.storage.persist) {
    try {
      navigator.storage.persist().catch(() => {});
    } catch (error) {
      // Persistence requests are best-effort.
    }
  }

  return state;
}

export function getState() {
  return state;
}

export function getActiveList() {
  const activeId = state.settings.activeListId;
  return (
    state.lists.find((list) => list.id === activeId && !list.archivedAt) ||
    state.lists.find((list) => !list.archivedAt) ||
    state.lists[0] ||
    null
  );
}

export function visibleLists() {
  return state.lists.filter((list) => !list.archivedAt);
}

export function setActiveList(listId) {
  const list = state.lists.find((entry) => entry.id === listId && !entry.archivedAt);
  if (!list || state.settings.activeListId === list.id) return false;

  state.settings.activeListId = list.id;
  commit();
  return true;
}

export function addList({ name, storeKey = 'custom', aisleOrder = null } = {}) {
  const list = createList(name, { storeKey, aisleOrder });
  state.lists.push(list);
  state.settings.activeListId = list.id;
  commit();
  return list;
}

export function visibleItems(list) {
  return list ? list.items.filter((item) => !item.deletedAt && item.name) : [];
}

export function visibleRecipes() {
  return state.recipes
    .filter((recipe) => !recipe.deletedAt && recipe.title)
    .sort(compareRecipes);
}

function compareRecipePosition(a, b) {
  const positionA = Number.isFinite(a.position) ? a.position : Number.POSITIVE_INFINITY;
  const positionB = Number.isFinite(b.position) ? b.position : Number.POSITIVE_INFINITY;
  if (positionA !== positionB) return positionA - positionB;
  return a.title.localeCompare(b.title);
}

function compareRecipes(a, b) {
  const categoryA = RECIPE_CATEGORY_ORDER.get(a.category) ?? RECIPE_CATEGORIES.length;
  const categoryB = RECIPE_CATEGORY_ORDER.get(b.category) ?? RECIPE_CATEGORIES.length;
  if (categoryA !== categoryB) return categoryA - categoryB;
  return compareRecipePosition(a, b);
}

function nextRecipePosition(category) {
  let highest = -1;
  for (const recipe of state.recipes) {
    if (recipe.deletedAt || recipe.category !== category) continue;
    if (Number.isFinite(recipe.position)) highest = Math.max(highest, recipe.position);
  }
  return highest + 1;
}

function uniqueRecipeTitle(title) {
  const used = new Set(
    state.recipes
      .filter((recipe) => !recipe.deletedAt && recipe.title)
      .map((recipe) => recipe.title.toLowerCase())
  );
  const base = `${title} copy`;
  if (!used.has(base.toLowerCase())) return base;

  let index = 2;
  while (used.has(`${base} ${index}`.toLowerCase())) index += 1;
  return `${base} ${index}`;
}

export function getRecipe(recipeId) {
  return state.recipes.find((recipe) => recipe.id === recipeId && !recipe.deletedAt) || null;
}

export function addRecipe(input) {
  const recipe = createRecipe(input);
  if (!recipe.title) return null;

  recipe.position = nextRecipePosition(recipe.category);
  state.recipes.push(recipe);
  commit();
  return recipe;
}

export function updateRecipe(recipeId, input = {}) {
  const recipe = getRecipe(recipeId);
  if (!recipe) return null;

  const title = String(input.title ?? recipe.title)
    .trim()
    .replace(/\s+/g, ' ');
  if (!title) return null;

  const next = createRecipe({
    ...recipe,
    ...input,
    title,
  });

  recipe.title = next.title;
  recipe.category = next.category;
  recipe.servings = next.servings;
  recipe.ingredients = next.ingredients;
  recipe.steps = next.steps;
  recipe.notes = next.notes;
  recipe.sourceUrl = next.sourceUrl;
  recipe.position = next.position;
  recipe.updatedAt = nowIso();
  commit();
  return recipe;
}

/** Sets one recipe ingredient's aisle without rewriting the rest of the recipe. */
export function setRecipeIngredientAisle(recipeId, ingredientIndex, aisle = null) {
  const recipe = getRecipe(recipeId);
  if (!recipe) return null;

  const index = Number(ingredientIndex);
  const ingredient = Number.isInteger(index) ? recipe.ingredients[index] : null;
  if (!ingredient) return null;

  const nextAisle = AISLES.includes(aisle) ? aisle : suggestAisle(ingredient.name);
  if (ingredient.aisle === nextAisle) return ingredient;

  ingredient.aisle = nextAisle;
  recipe.updatedAt = nowIso();
  commit();
  return ingredient;
}

export function deleteRecipe(recipeId) {
  const recipe = getRecipe(recipeId);
  if (!recipe) return false;

  recipe.deletedAt = nowIso();
  recipe.updatedAt = recipe.deletedAt;
  commit();
  return true;
}

/** Copies a recipe, placing the copy directly after the original. */
export function duplicateRecipe(recipeId) {
  const recipe = getRecipe(recipeId);
  if (!recipe) return null;

  const copy = createRecipe({
    title: uniqueRecipeTitle(recipe.title),
    category: recipe.category,
    servings: recipe.servings,
    ingredients: recipe.ingredients,
    steps: recipe.steps,
    notes: recipe.notes,
    sourceUrl: recipe.sourceUrl,
    position: Number.isFinite(recipe.position)
      ? recipe.position + 0.5
      : nextRecipePosition(recipe.category),
  });

  state.recipes.push(copy);
  commit();
  return copy;
}

/** Moves a recipe one place up or down inside its category. */
export function moveRecipe(recipeId, direction) {
  const recipe = getRecipe(recipeId);
  if (!recipe) return false;

  const step = Number(direction) < 0 ? -1 : 1;
  const group = state.recipes
    .filter((entry) => !entry.deletedAt && entry.title && entry.category === recipe.category)
    .sort(compareRecipePosition);
  const index = group.findIndex((entry) => entry.id === recipe.id);
  const targetIndex = index + step;
  if (index === -1 || targetIndex < 0 || targetIndex >= group.length) return false;

  [group[index], group[targetIndex]] = [group[targetIndex], group[index]];

  const timestamp = nowIso();
  group.forEach((entry, position) => {
    entry.position = position;
    if (entry.id === recipe.id || entry.id === group[index].id) {
      entry.updatedAt = timestamp;
    }
  });
  commit();
  return true;
}

export function addRecipeToList(recipeId, listId) {
  const recipe = getRecipe(recipeId);
  const list = state.lists.find(
    (entry) => entry.id === listId && !entry.archivedAt
  );
  if (!recipe || !list) return 0;

  let count = 0;
  for (const ingredient of recipe.ingredients) {
    const item = createItem({
      name: ingredient.name,
      qty: ingredient.qty,
      unit: ingredient.unit,
      aisle: ingredient.aisle,
      sourceRecipeId: recipe.id,
    });

    if (!item.name) continue;
    addOrMergeItem(list, item);
    count += 1;
  }

  if (count) {
    touchList(list);
    commit();
  }

  return count;
}

export function addRecipeToActiveList(recipeId) {
  const list = getActiveList();
  return list ? addRecipeToList(recipeId, list.id) : 0;
}

export function getPlanEntries() {
  return state.plan;
}

export function getPlanEntry(date, slot) {
  return state.plan.find((entry) => entry.date === date && entry.slot === slot) || null;
}

export function getPlanEntriesInRange(startDate, endDate) {
  return state.plan.filter((entry) => entry.date >= startDate && entry.date <= endDate);
}

export function getPlanEntriesInDate(date) {
  return state.plan.filter((entry) => entry.date === date);
}

/**
 * Plans a recipe in a date/slot and adds its ingredients to a list at the
 * planned servings. Unchecked items previously added by this plan entry are
 * replaced; checked items are kept.
 */
export function addRecipeToPlan({
  date,
  slot,
  recipeId,
  servings = null,
  listId = null,
} = {}) {
  const recipe = getRecipe(recipeId);
  const list = listId
    ? state.lists.find((entry) => entry.id === listId && !entry.archivedAt)
    : getActiveList();
  if (!recipe || !list) return null;

  const plannedServings = normalizeServings(servings ?? recipe.servings);
  const entry = upsertPlanEntry({
    date,
    slot,
    recipeId: recipe.id,
    title: recipe.title,
    servings: plannedServings,
  });
  if (!entry) return null;

  const removed = removePlanItems(entry.id);
  const preserved = new Set(
    list.items
      .filter((item) => {
        if (item.deletedAt || !item.checked) return false;
        const contributions = planContributionMap(item);
        return Object.prototype.hasOwnProperty.call(contributions, entry.id);
      })
      .map(itemMatchKey)
  );

  let added = 0;
  let skipped = 0;

  for (const ingredient of recipe.ingredients) {
    if (preserved.has(itemMatchKey(ingredient))) {
      skipped += 1;
      continue;
    }

    const item = createItem({
      name: ingredient.name,
      qty: scaleQuantity(ingredient.qty, recipe.servings, plannedServings),
      unit: ingredient.unit,
      aisle: ingredient.aisle,
      sourceRecipeId: recipe.id,
      sourcePlanEntryId: entry.id,
    });

    if (!item.name) continue;

    // Share a row with the same ingredient from another meal, while recording
    // this meal's quantity separately so clearing one meal stays exact.
    const existing = findVisibleMatch(list, item);
    if (existing) {
      addPlanContribution(existing, entry.id, item.qty);
      if (!existing.sourceRecipeId) existing.sourceRecipeId = recipe.id;
    } else {
      list.items.push(item);
    }
    added += 1;
  }

  if (added) touchList(list);
  commit();

  return { entry, recipe, list, added, skipped, removed };
}

export function setPlanMeal({ date, slot, title, servings = 1 } = {}) {
  const cleanTitle = String(title || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleanTitle) return null;

  const existing = getPlanEntry(date, slot);
  const entry = upsertPlanEntry({
    date,
    slot,
    recipeId: null,
    title: cleanTitle,
    servings,
  });
  if (!entry) return null;

  const removed = existing ? removePlanItems(existing.id) : 0;
  commit();
  return { entry, removed };
}

export function clearPlanEntry(date, slot) {
  const entry = getPlanEntry(date, slot);
  if (!entry) return null;

  const removed = removePlanItems(entry.id);
  state.plan = state.plan.filter((item) => item.id !== entry.id);
  commit();
  return { entry, removed };
}

export function clearPlanDay(date) {
  const entries = state.plan.filter((entry) => entry.date === date);
  if (!entries.length) return { cleared: 0, removed: 0 };

  let removed = 0;
  for (const entry of entries) removed += removePlanItems(entry.id);

  state.plan = state.plan.filter((entry) => entry.date !== date);
  commit();
  return { cleared: entries.length, removed };
}

export function getStorageInfo() {
  return { mode: storageMode, error: saveError || loadError };
}

export function getDataSummary() {
  return summarizeState(state);
}

export function createBackup() {
  return buildBackup(state);
}

export function recordExport(exportedAt = nowIso()) {
  const timestamp =
    typeof exportedAt === 'string' && !Number.isNaN(Date.parse(exportedAt))
      ? exportedAt
      : nowIso();
  state.settings.lastExportAt = timestamp;
  commit();
  return timestamp;
}

export function setKeepAwake(enabled) {
  const next = Boolean(enabled);
  if (state.settings.keepAwake === next) return false;

  state.settings.keepAwake = next;
  commit();
  return true;
}

export function inspectBackup(input) {
  const parsed = typeof input === 'string' ? readBackup(input) : parseBackup(input);
  return {
    summary: parsed.summary,
    exportedAt: parsed.exportedAt,
    appVersion: parsed.appVersion,
  };
}

export function importBackup(input) {
  const parsed = typeof input === 'string' ? readBackup(input) : parseBackup(input);

  state = parsed.state;
  if (parsed.exportedAt) state.settings.lastExportAt = parsed.exportedAt;
  ensureListDedupe();
  ensureRecipeOrder();
  loadError = '';
  if (storageMode !== 'memory') saveError = '';
  commit();

  return {
    summary: summarizeState(state),
    exportedAt: parsed.exportedAt,
  };
}

/**
 * Clears every list, item, recipe, plan entry, and setting, then restores the
 * same fresh state a first install receives (one Groceries list and the seeded
 * recipes). Waits for the replacement to reach storage.
 */
export async function resetToSeedData() {
  state = createEmptyState();
  ensureRecipeSeed();
  ensureListDedupe();
  ensureRecipeOrder();
  loadError = '';
  if (storageMode !== 'memory') saveError = '';
  commit();
  await flush();

  return { summary: summarizeState(state) };
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function addItem(listId, input) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (!list) return null;

  const item = createItem(input);
  if (!item.name) return null;

  const explicitAisle = AISLES.includes(input.aisle) ? input.aisle : null;
  const result = addOrMergeItem(list, item);
  if (explicitAisle && result.merged) result.item.aisle = explicitAisle;
  touchList(list);
  commit();
  return result.item;
}

export function updateItem(listId, itemId, input = {}) {
  const item = findItem(listId, itemId);
  if (!item) return null;

  const name = String(input.name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!name) return null;

  const nextQty = 'qty' in input ? normalizeQty(input.qty) : item.qty;
  const nextUnit =
    'unit' in input ? String(input.unit || '').trim() : item.unit;
  const quantityChanged = nextQty !== item.qty || nextUnit !== item.unit;
  const nextAisle =
    'aisle' in input && AISLES.includes(input.aisle)
      ? input.aisle
      : suggestAisle(name);

  item.name = name;
  item.qty = nextQty;
  item.unit = nextUnit;
  item.aisle = nextAisle;

  // A manually corrected quantity owns the row; it should no longer be
  // removed or reduced when a planned meal is changed later.
  if (quantityChanged) {
    item.sourcePlanEntryId = null;
    item.planContributions = null;
  }

  item.updatedAt = nowIso();
  touchListById(listId);
  commit();
  return item;
}

export function setItemChecked(listId, itemId, checked) {
  const item = findItem(listId, itemId);
  if (!item) return false;

  item.checked = Boolean(checked);
  item.updatedAt = nowIso();
  touchListById(listId);
  commit();
  return true;
}

export function deleteItem(listId, itemId) {
  const item = findItem(listId, itemId);
  if (!item) return false;

  item.deletedAt = nowIso();
  item.updatedAt = item.deletedAt;
  touchListById(listId);
  commit();
  return true;
}

/**
 * Moves one item to another visible list. If the target already has the same
 * item and unit, the quantities combine and the source row is tombstoned.
 */
export function moveItem(listId, itemId, targetListId) {
  if (listId === targetListId) return null;

  const source = state.lists.find((entry) => entry.id === listId);
  const target = state.lists.find(
    (entry) => entry.id === targetListId && !entry.archivedAt
  );
  const item = source
    ? source.items.find((entry) => entry.id === itemId && !entry.deletedAt)
    : null;
  if (!source || !target || !item) return null;

  const timestamp = nowIso();
  const existing = findVisibleMatch(target, item);
  let movedItem = item;
  let merged = false;

  if (existing) {
    // Keep the row checked only when both copies were already picked up.
    mergeItem(existing, item, {
      checked: Boolean(existing.checked && item.checked),
      timestamp,
    });

    item.deletedAt = timestamp;
    item.updatedAt = timestamp;
    movedItem = existing;
    merged = true;
  } else {
    const index = source.items.indexOf(item);
    if (index !== -1) source.items.splice(index, 1);
    target.items.push(item);
    item.updatedAt = timestamp;
  }

  touchList(source);
  touchList(target);
  commit();
  return { item: movedItem, sourceList: source, targetList: target, merged };
}

/**
 * Moves several items in one commit. Matching target rows combine quantities
 * exactly like a single move; source rows that merge are tombstoned.
 */
export function moveItems(listId, itemIds, targetListId) {
  if (listId === targetListId) return null;

  const source = state.lists.find((entry) => entry.id === listId);
  const target = state.lists.find(
    (entry) => entry.id === targetListId && !entry.archivedAt
  );
  if (!source || !target) return null;

  const ids = new Set(
    (Array.isArray(itemIds) ? itemIds : []).filter((id) => typeof id === 'string')
  );
  if (!ids.size) {
    return { moved: 0, merged: 0, sourceList: source, targetList: target };
  }

  const timestamp = nowIso();
  let moved = 0;
  let merged = 0;
  const selected = source.items.filter(
    (item) => ids.has(item.id) && !item.deletedAt && item.name
  );

  for (const item of selected) {
    const existing = findVisibleMatch(target, item);

    if (existing) {
      // Keep the target row checked only when both copies were already picked up.
      mergeItem(existing, item, {
        checked: Boolean(existing.checked && item.checked),
        timestamp,
      });
      item.deletedAt = timestamp;
      item.updatedAt = timestamp;
      merged += 1;
    } else {
      const index = source.items.indexOf(item);
      if (index === -1) continue;
      source.items.splice(index, 1);
      target.items.push(item);
      item.updatedAt = timestamp;
    }

    moved += 1;
  }

  if (moved) {
    touchList(source);
    touchList(target);
    commit();
  }

  return { moved, merged, sourceList: source, targetList: target };
}

/** Tombstones several items with one notification and save. */
export function deleteItems(listId, itemIds) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (!list) return null;

  const ids = new Set(
    (Array.isArray(itemIds) ? itemIds : []).filter((id) => typeof id === 'string')
  );
  const deletedIds = [];
  if (!ids.size) return { deleted: 0, itemIds: deletedIds, list };

  const timestamp = nowIso();
  for (const item of list.items) {
    if (!item.deletedAt && item.name && ids.has(item.id)) {
      item.deletedAt = timestamp;
      item.updatedAt = timestamp;
      deletedIds.push(item.id);
    }
  }

  if (deletedIds.length) {
    touchList(list);
    commit();
  }

  return { deleted: deletedIds.length, itemIds: deletedIds, list };
}

/** Restores several tombstoned items in one commit. */
export function restoreItems(listId, itemIds) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (!list) return null;

  const ids = new Set(
    (Array.isArray(itemIds) ? itemIds : []).filter((id) => typeof id === 'string')
  );
  const restoredIds = [];
  if (!ids.size) return { restored: 0, itemIds: restoredIds, list };

  const timestamp = nowIso();
  for (const item of list.items) {
    if (item.deletedAt && ids.has(item.id)) {
      item.deletedAt = null;
      item.updatedAt = timestamp;
      restoredIds.push(item.id);
    }
  }

  if (restoredIds.length) {
    touchList(list);
    commit();
  }

  return { restored: restoredIds.length, itemIds: restoredIds, list };
}

/** Removes every visible item from one list, returning ids for an undo. */
export function clearList(listId) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (!list) return null;

  const itemIds = list.items
    .filter((item) => !item.deletedAt && item.name)
    .map((item) => item.id);
  const result = deleteItems(listId, itemIds);
  return result ? { ...result, cleared: result.deleted } : null;
}

export function restoreItem(listId, itemId) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (!list) return null;

  const item = list.items.find((entry) => entry.id === itemId && entry.deletedAt);
  if (!item) return null;

  item.deletedAt = null;
  item.updatedAt = nowIso();
  touchList(list);
  commit();
  return item;
}

/** Saves a new shopping route for one list; every known aisle is retained once. */
export function updateListAisleOrder(listId, aisleOrder) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (!list) return false;

  const next = normalizeAisleOrder(aisleOrder);
  const unchanged =
    Array.isArray(list.aisleOrder) &&
    list.aisleOrder.length === next.length &&
    list.aisleOrder.every((aisle, index) => aisle === next[index]);

  if (unchanged) return false;

  list.aisleOrder = next;
  touchList(list);
  commit();
  return true;
}

export function renameList(listId, name) {
  const list = state.lists.find((entry) => entry.id === listId);
  const cleanName = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!list || !cleanName || cleanName === list.name) return false;

  list.name = cleanName;
  touchList(list);
  commit();
  return true;
}

/** Copies a list and its visible items, preserving checked state. */
export function duplicateList(listId) {
  const source = state.lists.find((entry) => entry.id === listId);
  if (!source) return null;

  const copy = createList(uniqueListName(`${source.name} copy`), {
    storeKey: source.storeKey,
    aisleOrder: source.aisleOrder,
  });

  copy.items = source.items
    .filter((item) => !item.deletedAt && item.name)
    .map((sourceItem) => {
      const item = createItem({
        name: sourceItem.name,
        qty: sourceItem.qty,
        unit: sourceItem.unit,
        aisle: sourceItem.aisle,
        sourceRecipeId: sourceItem.sourceRecipeId,
      });

      item.checked = Boolean(sourceItem.checked);
      item.note = typeof sourceItem.note === 'string' ? sourceItem.note : null;
      item.addedAt = sourceItem.addedAt;
      // The copy is a snapshot, not another owner of a planned meal's items.
      item.sourcePlanEntryId = null;
      return item;
    });

  state.lists.push(copy);
  state.settings.activeListId = copy.id;
  commit();
  return copy;
}

export function archiveList(listId) {
  const list = state.lists.find((entry) => entry.id === listId && !entry.archivedAt);
  if (!list) return null;

  const remaining = state.lists.filter(
    (entry) => !entry.archivedAt && entry.id !== list.id
  );
  if (!remaining.length) return null;

  const timestamp = nowIso();
  list.archivedAt = timestamp;
  list.updatedAt = timestamp;
  if (state.settings.activeListId === list.id) {
    state.settings.activeListId = remaining[0].id;
  }

  commit();
  return list;
}

export function restoreList(listId) {
  const list = state.lists.find((entry) => entry.id === listId && entry.archivedAt);
  if (!list) return null;

  list.archivedAt = null;
  list.updatedAt = nowIso();
  state.settings.activeListId = list.id;
  commit();
  return list;
}

/** Forces a write (used on pagehide / visibilitychange). */
export async function flush() {
  if (!ready) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  await persist();
}

/* ---------- Internals ---------- */

/** Fills in stable per-category positions for recipes saved before ordering. */
function ensureRecipeOrder() {
  const groups = new Map();

  for (const recipe of state.recipes) {
    if (recipe.deletedAt || !recipe.title) continue;
    if (!groups.has(recipe.category)) groups.set(recipe.category, []);
    groups.get(recipe.category).push(recipe);
  }

  let changed = false;
  for (const group of groups.values()) {
    const ordered = [...group].sort(compareRecipePosition);
    ordered.forEach((recipe, index) => {
      if (recipe.position !== index) {
        recipe.position = index;
        changed = true;
      }
    });
  }

  if (changed) state.updatedAt = nowIso();
}

function ensureRecipeSeed() {
  const currentVersion = Number(state.settings.recipeSeedVersion) || 0;
  if (currentVersion >= RECIPE_SEED_VERSION) return;

  const seeds = new Map();
  for (const seed of SEED_RECIPES) {
    if (!seed.seedKey) continue;
    seeds.set(seed.seedKey, createRecipe(seed));
  }

  const existingByKey = new Map();
  for (const recipe of state.recipes) {
    if (recipe.seedKey) existingByKey.set(recipe.seedKey, recipe);
  }

  for (const [seedKey, freshSeed] of seeds) {
    const existing = existingByKey.get(seedKey);
    if (!existing) {
      state.recipes.push(freshSeed);
      continue;
    }

    // Matching timestamps mean the seed recipe has never been edited. Refresh
    // its vocabulary, but never overwrite a recipe the household changed.
    if (!existing.deletedAt && existing.createdAt === existing.updatedAt) {
      const timestamp = nowIso();
      existing.ingredients = freshSeed.ingredients;
      existing.createdAt = timestamp;
      existing.updatedAt = timestamp;
    }
  }

  state.settings.recipeSeedVersion = RECIPE_SEED_VERSION;
  state.updatedAt = nowIso();
}

/**
 * One-time cleanup for lists saved before matching and per-meal quantity
 * tracking. Duplicate rows, including ones created by separate planned meals,
 * are combined into one row with each meal's contribution recorded.
 */
function ensureListDedupe() {
  const currentVersion = Number(state.settings.itemMergeVersion) || 0;
  if (currentVersion >= ITEM_MERGE_VERSION) return;

  const timestamp = nowIso();

  for (const list of state.lists) {
    const seen = new Map();
    let changed = false;

    for (const item of list.items) {
      if (item.deletedAt || !item.name) continue;

      const key = itemMatchKey(item);
      const existing = seen.get(key);
      if (!existing) {
        seen.set(key, item);
        continue;
      }

      mergeItem(existing, item, {
        checked: Boolean(existing.checked && item.checked),
        timestamp,
      });
      item.deletedAt = timestamp;
      item.updatedAt = timestamp;
      changed = true;
    }

    if (changed) touchList(list);
  }

  state.settings.itemMergeVersion = ITEM_MERGE_VERSION;
  state.updatedAt = nowIso();
}

function notify() {
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      console.error('Store listener failed', error);
    }
  }
}

function commit() {
  state.updatedAt = nowIso();
  notify();
  scheduleSave();
}

function upsertPlanEntry({ date, slot, recipeId = null, title = '', servings = null }) {
  const existing = getPlanEntry(date, slot);
  const next = normalizePlanEntry({
    id: existing ? existing.id : undefined,
    date,
    slot,
    recipeId,
    title,
    servings,
    createdAt: existing ? existing.createdAt : undefined,
    updatedAt: nowIso(),
  });
  if (!next) return null;

  if (existing) {
    existing.recipeId = next.recipeId;
    existing.title = next.title;
    existing.servings = next.servings;
    existing.updatedAt = next.updatedAt;
    return existing;
  }

  state.plan.push(next);
  return next;
}

function removePlanItems(planEntryId) {
  if (!planEntryId) return 0;

  const timestamp = nowIso();
  let removed = 0;

  for (const list of state.lists) {
    let touched = false;

    for (const item of list.items) {
      if (item.deletedAt) continue;

      const contributions = planContributionMap(item);
      if (!Object.prototype.hasOwnProperty.call(contributions, planEntryId)) {
        continue;
      }

      // Checked rows are already bought. Clearing a meal should leave them in
      // place, including the amount contributed by that meal.
      if (item.checked) continue;

      const baseQty = manualBaseQuantity(item, contributions);
      delete contributions[planEntryId];

      if (!Object.keys(contributions).length && baseQty <= 0) {
        item.deletedAt = timestamp;
        item.updatedAt = timestamp;
        syncPlanSource(item, contributions);
        removed += 1;
      } else {
        setItemQuantity(item, baseQty, contributions);
        item.updatedAt = timestamp;
      }

      touched = true;
    }

    if (touched) touchList(list);
  }

  return removed;
}

function scaleQuantity(qty, recipeServings, plannedServings) {
  if (qty === null || qty === undefined) return null;
  const from = Number(recipeServings) || 1;
  const to = Number(plannedServings) || from;
  return normalizeQty(qty * (to / from));
}

function planContributionMap(item) {
  if (!item) return {};

  if (
    item.planContributions &&
    typeof item.planContributions === 'object' &&
    !Array.isArray(item.planContributions) &&
    Object.keys(item.planContributions).length
  ) {
    return item.planContributions;
  }

  const contributions = {};
  if (item.sourcePlanEntryId) {
    contributions[item.sourcePlanEntryId] = Number(item.qty) || 0;
  }
  item.planContributions = Object.keys(contributions).length
    ? contributions
    : null;
  return contributions;
}

function sumPlanContributions(contributions) {
  return Object.values(contributions).reduce(
    (sum, qty) => sum + (Number(qty) || 0),
    0
  );
}

function combinedContribution(current, addition) {
  const total = (Number(current) || 0) + (Number(addition) || 0);
  return Math.round(total * 1000) / 1000;
}

function manualBaseQuantity(item, contributions = planContributionMap(item)) {
  return Math.max(
    0,
    (Number(item && item.qty) || 0) - sumPlanContributions(contributions)
  );
}

function syncPlanSource(item, contributions) {
  const entryIds = Object.keys(contributions);
  item.sourcePlanEntryId = entryIds.length === 1 ? entryIds[0] : null;
  item.planContributions = entryIds.length ? contributions : null;
}

function setItemQuantity(item, baseQty, contributions) {
  item.qty = normalizeQty(baseQty + sumPlanContributions(contributions));
  item.unit = displayUnitForQuantity(item.unit, item.qty);
  syncPlanSource(item, contributions);
}

function addPlanContribution(item, planEntryId, qty) {
  const contributions = planContributionMap(item);
  const baseQty = manualBaseQuantity(item, contributions);
  contributions[planEntryId] = combinedContribution(
    contributions[planEntryId],
    qty
  );
  setItemQuantity(item, baseQty, contributions);
  item.checked = false;
  item.updatedAt = nowIso();
  return item;
}

/* Unit matching ignores case and simple singular/plural differences, so "1 cup
 * flour" and "2 cups flour" combine instead of producing two rows. */
const COUNT_UNIT_FORMS = new Map([
  ['cup', 'cups'],
  ['clove', 'cloves'],
  ['can', 'cans'],
  ['carton', 'cartons'],
  ['slice', 'slices'],
  ['bunch', 'bunches'],
  ['bag', 'bags'],
  ['pack', 'packs'],
  ['jar', 'jars'],
  ['bottle', 'bottles'],
  ['box', 'boxes'],
  ['pinch', 'pinches'],
  ['dash', 'dashes'],
  ['stick', 'sticks'],
  ['head', 'heads'],
  ['sprig', 'sprigs'],
  ['fillet', 'fillets'],
  ['piece', 'pieces'],
]);

const MEASURE_UNIT_FORMS = new Map([
  ['tbsp', 'tbsp'],
  ['tablespoon', 'tbsp'],
  ['tablespoons', 'tbsp'],
  ['tsp', 'tsp'],
  ['teaspoon', 'tsp'],
  ['teaspoons', 'tsp'],
  ['lb', 'lb'],
  ['lbs', 'lb'],
  ['pound', 'lb'],
  ['pounds', 'lb'],
  ['oz', 'oz'],
  ['ounce', 'oz'],
  ['ounces', 'oz'],
  ['g', 'g'],
  ['gram', 'g'],
  ['grams', 'g'],
  ['kg', 'kg'],
  ['kilogram', 'kg'],
  ['kilograms', 'kg'],
  ['ml', 'ml'],
  ['milliliter', 'ml'],
  ['milliliters', 'ml'],
  ['l', 'l'],
  ['liter', 'l'],
  ['liters', 'l'],
]);

const UNIT_ALIASES = new Map();
for (const [singular, plural] of COUNT_UNIT_FORMS) {
  UNIT_ALIASES.set(singular, singular);
  UNIT_ALIASES.set(plural, singular);
}
for (const [alias, canonical] of MEASURE_UNIT_FORMS) {
  UNIT_ALIASES.set(alias, canonical);
}

function unitMatchKey(unit) {
  const clean = String(unit || '')
    .trim()
    .toLowerCase();
  return UNIT_ALIASES.get(clean) || clean;
}

function displayUnitForQuantity(unit, qty) {
  const clean = String(unit || '').trim();
  if (!clean) return '';
  if (qty === null || qty === undefined) return clean;

  const key = unitMatchKey(clean);
  if (MEASURE_UNIT_FORMS.has(key)) return key;

  const plural = COUNT_UNIT_FORMS.get(key);
  if (plural) return Number(qty) === 1 ? key : plural;

  return clean;
}

/* A few common grocery plurals do not follow the usual rules. The rest of the
 * singularizer is intentionally conservative so words like asparagus, hummus,
 * and glass are left alone. */
const NAME_PLURAL_EXCEPTIONS = new Map([
  ['cookies', 'cookie'],
  ['brownies', 'brownie'],
  ['smoothies', 'smoothie'],
  ['pies', 'pie'],
  ['veggies', 'veggie'],
  ['fries', 'fry'],
  ['quiches', 'quiche'],
  ['chilies', 'chile'],
  ['chilis', 'chile'],
  ['glasses', 'glass'],
  ['loaves', 'loaf'],
  ['knives', 'knife'],
  ['leaves', 'leaf'],
  ['halves', 'half'],
]);

function singularNameWord(word) {
  if (word.length < 3) return word;

  const exception = NAME_PLURAL_EXCEPTIONS.get(word);
  if (exception) return exception;

  if (/(ss|us|is)$/.test(word)) return word;
  if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.endsWith('oes')) return word.slice(0, -2);
  if (/(ches|shes|xes|zes)$/.test(word)) return word.slice(0, -2);
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

function itemNameKey(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .split(' ')
    .map(singularNameWord)
    .join(' ');
}

function itemMatchKey(item) {
  return `${itemNameKey(item && item.name)}|${unitMatchKey(item && item.unit)}`;
}

function findVisibleMatch(list, item) {
  if (!list || !item || !item.name) return null;
  const key = itemMatchKey(item);

  return (
    list.items.find(
      (entry) =>
        !entry.deletedAt && entry.name && itemMatchKey(entry) === key
    ) || null
  );
}

/** Combines a duplicate row into an existing item and keeps its identity. */
function mergeItem(existing, item, { checked = false, timestamp = nowIso() } = {}) {
  const existingContributions = planContributionMap(existing);
  const itemContributions = planContributionMap(item);
  const existingBaseQty = manualBaseQuantity(existing, existingContributions);
  const itemBaseQty = manualBaseQuantity(item, itemContributions);

  for (const [planEntryId, qty] of Object.entries(itemContributions)) {
    existingContributions[planEntryId] = combinedContribution(
      existingContributions[planEntryId],
      qty
    );
  }

  setItemQuantity(
    existing,
    existingBaseQty + itemBaseQty,
    existingContributions
  );
  existing.checked = Boolean(checked);
  if (!existing.sourceRecipeId && item.sourceRecipeId) {
    existing.sourceRecipeId = item.sourceRecipeId;
  }
  if (!existing.note && item.note) existing.note = item.note;
  existing.updatedAt = timestamp;
  return existing;
}

/**
 * Adds an item to a list, or combines its quantity with an existing matching
 * item. Adding to an already checked row unchecks it because the new quantity
 * still needs to be bought.
 */
function addOrMergeItem(list, item) {
  const existing = findVisibleMatch(list, item);
  if (!existing) {
    list.items.push(item);
    return { item, merged: false };
  }

  mergeItem(existing, item, { checked: false });
  return { item: existing, merged: true };
}

function touchList(list) {
  list.updatedAt = nowIso();
}

function touchListById(listId) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (list) touchList(list);
}

function uniqueListName(base) {
  const names = new Set(state.lists.map((list) => list.name.toLowerCase()));
  const clean = String(base || '').trim() || 'Groceries copy';
  if (!names.has(clean.toLowerCase())) return clean;

  let index = 2;
  while (names.has(`${clean} ${index}`.toLowerCase())) index += 1;
  return `${clean} ${index}`;
}

function findItem(listId, itemId) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (!list) return null;
  return list.items.find((item) => item.id === itemId && !item.deletedAt) || null;
}

function scheduleSave() {
  if (!ready || storageMode === 'memory') return;

  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    persist();
  }, 180);
}

function persist() {
  if (!ready || storageMode === 'memory') return Promise.resolve();

  saveChain = saveChain.then(async () => {
    try {
      if (database) {
        await idbPut(database, state);
      } else {
        localStorage.setItem(STORAGE.localStorageKey, JSON.stringify(state));
      }

      if (saveError) {
        saveError = '';
        notify();
      }
    } catch (error) {
      console.error('Could not save state.', error);
      const message = 'Changes could not be saved. Storage may be full or blocked.';
      if (saveError !== message) {
        saveError = message;
        notify();
      }
    }
  });

  return saveChain;
}

function localStorageWorks() {
  try {
    const key = `${STORAGE.localStorageKey}:probe`;
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return true;
  } catch (error) {
    return false;
  }
}

function preserveUnreadableData(raw) {
  try {
    const key = `${STORAGE.localStorageKey}:unreadable:${Date.now()}`;
    localStorage.setItem(key, typeof raw === 'string' ? raw : JSON.stringify(raw));
    return true;
  } catch (error) {
    return false;
  }
}

/* ---------- IndexedDB ---------- */

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available'));
      return;
    }

    let settled = false;
    const request = indexedDB.open(STORAGE.dbName, STORAGE.dbVersion);

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('IndexedDB open timed out'));
    }, 3000);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORAGE.storeName)) {
        db.createObjectStore(STORAGE.storeName);
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      if (settled) {
        db.close();
        return;
      }

      settled = true;
      clearTimeout(timer);

      // If another tab upgrades the schema, step aside rather than blocking it.
      db.onversionchange = () => db.close();

      resolve(db);
    };

    request.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(request.error || new Error('Could not open IndexedDB'));
    };

    request.onblocked = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('IndexedDB upgrade is blocked by another tab'));
    };
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORAGE.storeName, 'readonly');
    const request = transaction.objectStore(STORAGE.storeName).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB read failed'));
  });
}

function idbPut(db, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORAGE.storeName, 'readwrite');
    transaction.objectStore(STORAGE.storeName).put(value, STORAGE.stateKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted'));
  });
}

/* ---------- Lifecycle ---------- */

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    flush();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}
