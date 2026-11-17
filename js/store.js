/* State container + persistence.
 *
 * One state document is kept in IndexedDB (localStorage fallback), written
 * with a short debounce. Every mutation notifies subscribers synchronously.
 */

import { AISLES, RECIPE_CATEGORIES, STORAGE, STORE_PRESETS } from './config.js';
import { createBackup as buildBackup, parseBackup, readBackup } from './backup.js';
import {
  createEmptyState,
  createItem,
  createList,
  createPlanEntry,
  createPlanTombstone,
  createRecipe,
  normalizeAisleOrder,
  normalizeQty,
  normalizeState,
  nowIso,
  suggestAisle,
  summarizeState,
  uid,
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

/* Device-local list versions. Kept out of the state document so backups and
 * sync never carry device history. */
let listHistory = { version: 1, lists: {} };
let historyDirty = false;
let historyTimer = null;

const HISTORY_LIMIT = 20;
const HISTORY_MAX_LISTS = 40;
/* Repeated tweaks of the same kind share one "before" revision, so a whole
 * shopping session or a burst of edits does not push out older versions. */
const HISTORY_WINDOWS = {
  check: 15 * 60 * 1000,
  item: 3 * 60 * 1000,
  plan: 3 * 60 * 1000,
  structure: 0,
};

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
  await loadListHistory();
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
    state.lists.find((list) => list.id === activeId && !list.archivedAt && !list.deletedAt) ||
    state.lists.find((list) => !list.archivedAt && !list.deletedAt) ||
    state.lists.find((list) => !list.deletedAt) ||
    null
  );
}

export function visibleLists() {
  return state.lists.filter((list) => !list.archivedAt && !list.deletedAt);
}

export function setActiveList(listId) {
  const list = state.lists.find(
    (entry) => entry.id === listId && !entry.archivedAt && !entry.deletedAt
  );
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
  return (
    a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) ||
    compareRecipePosition(a, b)
  );
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

export function addRecipeToList(recipeId, listId) {
  const recipe = getRecipe(recipeId);
  const list = state.lists.find(
    (entry) => entry.id === listId && !entry.archivedAt && !entry.deletedAt
  );
  if (!recipe || !list) return 0;

  captureListRevision(list.id, 'Before adding a recipe', { group: 'item' });

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

export function getPlanEntry(entryId) {
  return state.plan.find((entry) => entry.id === entryId) || null;
}

function resolvePlanList(listId) {
  return listId
    ? state.lists.find(
        (entry) => entry.id === listId && !entry.archivedAt && !entry.deletedAt
      )
    : getActiveList();
}

/**
 * Adds a recipe's ingredients to the chosen list.
 * Unchecked items previously added by this plan entry are replaced; checked
 * items are kept. Each planned meal has its own id, so the same recipe can be
 * planned more than once and its contributions stay separate.
 */
function applyRecipeToPlan(entry, recipe, list) {
  captureListRevision(list.id, 'Before changing meal plan ingredients', { group: 'plan' });

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
      qty: ingredient.qty,
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
  return { entry, recipe, list, added, skipped, removed };
}

export function addRecipeToPlan({ recipeId, listId = null } = {}) {
  const recipe = getRecipe(recipeId);
  const list = resolvePlanList(listId);
  if (!recipe || !list) return null;

  const entry = createPlanEntry({
    recipeId: recipe.id,
    title: recipe.title,
  });
  state.plan.push(entry);

  const result = applyRecipeToPlan(entry, recipe, list);
  commit();
  return result;
}

export function updatePlanRecipe({ entryId, recipeId, listId = null } = {}) {
  const entry = getPlanEntry(entryId);
  const recipe = getRecipe(recipeId);
  const list = resolvePlanList(listId);
  if (!entry || !recipe || !list) return null;

  entry.recipeId = recipe.id;
  entry.title = recipe.title;
  entry.updatedAt = nowIso();

  const result = applyRecipeToPlan(entry, recipe, list);
  commit();
  return result;
}

export function addPlanMeal({ title } = {}) {
  const cleanTitle = String(title || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!cleanTitle) return null;

  const entry = createPlanEntry({ title: cleanTitle });
  state.plan.push(entry);
  commit();
  return { entry, removed: 0 };
}

export function updatePlanMeal({ entryId, title } = {}) {
  const entry = getPlanEntry(entryId);
  const cleanTitle = String(title || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!entry || !cleanTitle) return null;

  const removed = entry.recipeId ? removePlanItems(entry.id) : 0;
  entry.recipeId = null;
  entry.title = cleanTitle;
  entry.updatedAt = nowIso();
  commit();
  return { entry, removed };
}

export function removePlanEntry(entryId) {
  const entry = getPlanEntry(entryId);
  if (!entry) return null;

  const timestamp = nowIso();
  const removed = removePlanItems(entry.id);
  state.plan = state.plan.filter((item) => item.id !== entry.id);
  addPlanTombstone(entry.id, timestamp);
  commit();
  return { entry, removed };
}

/** Empties the meal list. Ingredients already on grocery lists are kept. */
export function clearPlan() {
  const cleared = state.plan.length;
  if (!cleared) return { cleared: 0 };

  const timestamp = nowIso();
  for (const entry of state.plan) addPlanTombstone(entry.id, timestamp);
  state.plan = [];
  commit();
  return { cleared };
}

export function getIdeas() {
  return state.ideas;
}

export function setIdeas(text) {
  const value = typeof text === 'string' ? text : '';
  if (state.ideas && state.ideas.text === value) return false;

  state.ideas = { text: value, updatedAt: nowIso() };
  commit();
  return true;
}

export function getStorageInfo() {
  return { mode: storageMode, error: saveError || loadError };
}

/** Reads a device-local metadata value (sync credentials, snapshots). */
export async function readMeta(key) {
  if (database) {
    return idbGet(database, key);
  }

  try {
    const raw = localStorage.getItem(`${STORAGE.metaLocalStoragePrefix}${key}`);
    return raw === null ? null : JSON.parse(raw);
  } catch (error) {
    return null;
  }
}

/** Writes a device-local metadata value. Never part of backups or sync state. */
export async function writeMeta(key, value) {
  if (database) {
    await idbPutKey(database, key, value);
    return;
  }

  if (storageMode === 'memory') {
    throw new Error('This browser is blocking storage.');
  }

  localStorage.setItem(`${STORAGE.metaLocalStoragePrefix}${key}`, JSON.stringify(value));
}

export async function deleteMeta(key) {
  if (database) {
    await idbDeleteKey(database, key);
    return;
  }

  try {
    localStorage.removeItem(`${STORAGE.metaLocalStoragePrefix}${key}`);
  } catch (error) {
    // Best effort.
  }
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

  captureAllLists('Before restoring a backup', { group: 'structure', force: true });

  state = parsed.state;
  if (parsed.exportedAt) state.settings.lastExportAt = parsed.exportedAt;
  ensureListDedupe();
  ensureRecipeOrder();
  reconcileListItems();
  if (pruneListHistory()) scheduleHistorySave();
  loadError = '';
  if (storageMode !== 'memory') saveError = '';
  commit();

  return {
    summary: summarizeState(state),
    exportedAt: parsed.exportedAt,
  };
}

/**
 * Replaces local state with a state that has already been merged with the
 * partner's phone. Keeps the same notification/persistence path as a normal
 * edit so every open view refreshes.
 */
export function applySyncState(nextState) {
  state = normalizeState(nextState);
  ensureRecipeOrder();
  reconcileListItems();
  loadError = '';
  if (storageMode !== 'memory') saveError = '';
  commit({ touch: false });
  return state;
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
  if (pruneListHistory()) scheduleHistorySave();
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
  captureListRevision(list.id, 'Before adding an item', { group: 'item' });
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

  captureListRevision(listId, 'Before editing an item', { group: 'item' });

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

  const nextChecked = Boolean(checked);
  if (item.checked === nextChecked) return true;

  captureListRevision(
    listId,
    nextChecked ? 'Before picking up items' : 'Before unpicking items',
    { group: 'check' }
  );

  item.checked = nextChecked;
  item.updatedAt = nowIso();
  touchListById(listId);
  commit();
  return true;
}

export function deleteItem(listId, itemId) {
  const item = findItem(listId, itemId);
  if (!item) return false;

  captureListRevision(listId, 'Before deleting an item', { group: 'item' });

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

  captureListRevision(source.id, 'Before moving items', { group: 'item' });
  if (existing) captureListRevision(target.id, 'Before moving items', { group: 'item' });

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
    const moved = cloneItemForList(item, timestamp);
    item.deletedAt = timestamp;
    item.updatedAt = timestamp;
    target.items.push(moved);
    movedItem = moved;
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
  if (!selected.length) {
    return { moved: 0, merged: 0, sourceList: source, targetList: target };
  }

  const willMerge = selected.some((item) => findVisibleMatch(target, item));
  captureListRevision(source.id, 'Before moving items', { group: 'item' });
  if (willMerge) captureListRevision(target.id, 'Before moving items', { group: 'item' });

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
      const moved = cloneItemForList(item, timestamp);
      item.deletedAt = timestamp;
      item.updatedAt = timestamp;
      target.items.push(moved);
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

  const targets = list.items.filter(
    (item) => !item.deletedAt && item.name && ids.has(item.id)
  );
  if (!targets.length) return { deleted: 0, itemIds: deletedIds, list };

  captureListRevision(listId, 'Before deleting items', { group: 'item' });

  const timestamp = nowIso();
  for (const item of targets) {
    item.deletedAt = timestamp;
    item.updatedAt = timestamp;
    deletedIds.push(item.id);
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

  const targets = list.items.filter((item) => item.deletedAt && ids.has(item.id));
  if (!targets.length) return { restored: 0, itemIds: restoredIds, list };

  captureListRevision(listId, 'Before restoring items', { group: 'item' });

  const timestamp = nowIso();
  for (const item of targets) {
    item.deletedAt = null;
    item.updatedAt = timestamp;
    restoredIds.push(item.id);
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
  if (!itemIds.length) return { deleted: 0, itemIds: [], list, cleared: 0 };

  captureListRevision(list.id, 'Before clearing the list', { group: 'structure' });

  const result = deleteItems(listId, itemIds);
  return result ? { ...result, cleared: result.deleted } : null;
}

export function restoreItem(listId, itemId) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (!list) return null;

  const item = list.items.find((entry) => entry.id === itemId && entry.deletedAt);
  if (!item) return null;

  captureListRevision(list.id, 'Before restoring an item', { group: 'item' });

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

  captureListRevision(list.id, 'Before changing aisle order', { group: 'structure' });

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

  captureListRevision(list.id, 'Before renaming the list', { group: 'structure' });

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
    (entry) => !entry.archivedAt && !entry.deletedAt && entry.id !== list.id
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
  const list = state.lists.find(
    (entry) => entry.id === listId && entry.archivedAt && !entry.deletedAt
  );
  if (!list) return null;

  list.archivedAt = null;
  list.updatedAt = nowIso();
  state.settings.activeListId = list.id;
  commit();
  return list;
}

/**
 * Deletes an archived list for good. The row is kept as a tombstone (with
 * deletedAt) so device sync cannot resurrect it from an older copy.
 */
export function deleteList(listId) {
  const list = state.lists.find(
    (entry) => entry.id === listId && entry.archivedAt && !entry.deletedAt
  );
  if (!list) return null;

  const timestamp = nowIso();
  list.deletedAt = timestamp;
  list.updatedAt = timestamp;
  if (state.settings.activeListId === list.id) {
    const fallback =
      state.lists.find((entry) => !entry.archivedAt && !entry.deletedAt) ||
      state.lists.find((entry) => !entry.deletedAt);
    if (fallback) state.settings.activeListId = fallback.id;
  }

  commit();
  return list;
}

/** Undoes deleteList; the list goes back to the archived section. */
export function undeleteList(listId) {
  const list = state.lists.find((entry) => entry.id === listId && entry.deletedAt);
  if (!list) return null;

  list.deletedAt = null;
  list.updatedAt = nowIso();
  commit();
  return list;
}

/**
 * Device-local versions for one list, newest first. Each entry is a summary
 * plus the item rows as they looked at that moment. History never leaves this
 * device and is not part of backups or sync.
 */
export function getListHistory(listId) {
  const record = listHistory.lists[listId];
  if (!record || !Array.isArray(record.revisions)) return [];

  return record.revisions.map((revision) => {
    const items = Array.isArray(revision.items) ? revision.items : [];
    return {
      id: revision.id,
      savedAt: revision.savedAt,
      label: revision.label,
      itemCount: items.length,
      checkedCount: items.filter((item) => item.checked).length,
      items: items.map((item) => ({ ...item })),
    };
  });
}

/** Replaces a list with a saved version. The pre-restore version is saved too. */
export function restoreListRevision(listId, revisionId) {
  const list = state.lists.find((entry) => entry.id === listId && !entry.deletedAt);
  const record = listHistory.lists[listId];
  const revision =
    record && Array.isArray(record.revisions)
      ? record.revisions.find((entry) => entry.id === revisionId)
      : null;
  if (!list || !revision) return null;

  const undoRevisionId = captureListRevision(listId, 'Before restore', {
    group: 'structure',
    force: true,
  });

  const cleanName = String(revision.name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (cleanName) list.name = cleanName;

  list.storeKey = Object.prototype.hasOwnProperty.call(STORE_PRESETS, revision.storeKey)
    ? revision.storeKey
    : 'custom';
  list.aisleOrder = normalizeAisleOrder(revision.aisleOrder);

  // Ids used by other lists must never be taken over by a restore.
  const liveIdsElsewhere = new Set();
  for (const other of state.lists) {
    if (other.id === list.id) continue;
    for (const item of other.items) {
      if (!item.deletedAt) liveIdsElsewhere.add(item.id);
    }
  }

  const restoredIds = new Set();
  const restoredItems = (Array.isArray(revision.items) ? revision.items : []).map((saved) => {
    const item = createItem({
      name: saved.name,
      qty: saved.qty,
      unit: saved.unit,
      aisle: saved.aisle,
      sourceRecipeId: saved.sourceRecipeId,
      sourcePlanEntryId: saved.sourcePlanEntryId,
      planContributions: saved.planContributions,
    });

    if (
      typeof saved.id === 'string' &&
      saved.id &&
      !liveIdsElsewhere.has(saved.id) &&
      !restoredIds.has(saved.id)
    ) {
      item.id = saved.id;
    }

    item.checked = Boolean(saved.checked);
    item.note = typeof saved.note === 'string' ? saved.note : null;
    if (typeof saved.addedAt === 'string' && saved.addedAt) item.addedAt = saved.addedAt;
    restoredIds.add(item.id);
    return item;
  });

  // Keep tombstones so a stale copy on the partner phone cannot resurrect a
  // deleted row, but let a restored row reclaim its own old tombstone.
  const tombstones = list.items.filter(
    (item) => item.deletedAt && !restoredIds.has(item.id)
  );

  // Rows that exist now but not in the saved version are deleted, not dropped,
  // so the deletion propagates through sync.
  const timestamp = nowIso();
  const removed = list.items.filter(
    (item) => !item.deletedAt && item.name && !restoredIds.has(item.id)
  );
  for (const item of removed) {
    item.deletedAt = timestamp;
    item.updatedAt = timestamp;
  }

  list.items = [...restoredItems, ...tombstones, ...removed];

  touchList(list);
  commit();

  return {
    list,
    restored: restoredItems.length,
    undoRevisionId,
    revision: { id: revision.id, savedAt: revision.savedAt, label: revision.label },
  };
}

/** Forces a write (used on pagehide / visibilitychange). */
export async function flush() {
  if (!ready) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (historyTimer) {
    clearTimeout(historyTimer);
    historyTimer = null;
  }
  await persist();
  await persistHistory();
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

function commit({ touch = true } = {}) {
  if (touch) state.updatedAt = nowIso();
  notify();
  scheduleSave();
}

function addPlanTombstone(entryId, deletedAt = nowIso()) {
  const tombstone = createPlanTombstone(entryId, deletedAt);
  if (!tombstone) return;

  if (!Array.isArray(state.planTombstones)) state.planTombstones = [];
  state.planTombstones = state.planTombstones.filter(
    (entry) => entry.id !== tombstone.id
  );
  state.planTombstones.push(tombstone);
}

function removePlanItems(planEntryId) {
  if (!planEntryId) return 0;

  const timestamp = nowIso();
  let removed = 0;

  for (const list of state.lists) {
    let touched = false;

    const affected = list.items.some((item) => {
      if (item.deletedAt || item.checked) return false;
      return Object.prototype.hasOwnProperty.call(planContributionMap(item), planEntryId);
    });
    if (affected) {
      captureListRevision(list.id, 'Before changing meal plan ingredients', { group: 'plan' });
    }

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

/** Moves a row to another list while leaving a tombstone behind for sync. */
function cloneItemForList(item, timestamp = nowIso()) {
  const copy = createItem({
    name: item.name,
    qty: item.qty,
    unit: item.unit,
    aisle: item.aisle,
    sourceRecipeId: item.sourceRecipeId,
    sourcePlanEntryId: item.sourcePlanEntryId,
    planContributions: item.planContributions,
  });

  copy.checked = Boolean(item.checked);
  copy.note = typeof item.note === 'string' ? item.note : null;
  copy.addedAt = item.addedAt;
  copy.updatedAt = timestamp;
  return copy;
}

function itemUpdatedTime(item) {
  return Date.parse(item && item.updatedAt) || Date.parse(item && item.addedAt) || 0;
}

/**
 * After a sync merge, two phones may have independently added the same
 * ingredient. Combine matching rows, sum manual quantities, union planned-meal
 * contributions by entry id (never double-count the same meal), and tombstone
 * the losing rows so the cleanup propagates.
 */
function reconcileListItems() {
  let changedAny = false;

  for (const list of state.lists) {
    const groups = new Map();

    for (const item of list.items) {
      if (item.deletedAt || !item.name) continue;
      const key = itemMatchKey(item);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    }

    let listChanged = false;

    for (const group of groups.values()) {
      if (group.length < 2) continue;

      group.sort(
        (a, b) =>
          itemUpdatedTime(b) - itemUpdatedTime(a) ||
          String(a.id).localeCompare(String(b.id))
      );

      const [base, ...duplicates] = group;
      const contributions = planContributionMap(base);
      let baseQty = manualBaseQuantity(base, contributions);
      let checked = Boolean(base.checked);

      for (const duplicate of duplicates) {
        const duplicateContributions = planContributionMap(duplicate);
        baseQty += manualBaseQuantity(duplicate, duplicateContributions);

        for (const [planEntryId, qty] of Object.entries(duplicateContributions)) {
          contributions[planEntryId] = Math.max(
            Number(contributions[planEntryId]) || 0,
            Number(qty) || 0
          );
        }

        // Only keep the row bought when both copies were already picked up.
        checked = checked && Boolean(duplicate.checked);

        if (!base.sourceRecipeId && duplicate.sourceRecipeId) {
          base.sourceRecipeId = duplicate.sourceRecipeId;
        }
        if (!base.note && duplicate.note) base.note = duplicate.note;
        if (!base.aisle && duplicate.aisle) base.aisle = duplicate.aisle;

        const timestamp = nowIso();
        duplicate.deletedAt = timestamp;
        duplicate.updatedAt = timestamp;
        listChanged = true;
      }

      setItemQuantity(base, baseQty, contributions);
      base.checked = checked;
      base.updatedAt = nowIso();
    }

    if (listChanged) {
      touchList(list);
      changedAny = true;
    }
  }

  if (changedAny) state.updatedAt = nowIso();
  return changedAny;
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

/* ---------- List history ---------- */

function snapshotList(list) {
  return {
    name: list.name,
    storeKey: list.storeKey,
    aisleOrder: Array.isArray(list.aisleOrder) ? [...list.aisleOrder] : [],
    items: list.items
      .filter((item) => !item.deletedAt && item.name)
      .map((item) => ({
        id: item.id,
        name: item.name,
        qty: item.qty,
        unit: item.unit,
        aisle: item.aisle,
        checked: Boolean(item.checked),
        note: typeof item.note === 'string' ? item.note : null,
        sourceRecipeId: item.sourceRecipeId || null,
        sourcePlanEntryId: item.sourcePlanEntryId || null,
        planContributions:
          item.planContributions && typeof item.planContributions === 'object'
            ? { ...item.planContributions }
            : null,
        addedAt: item.addedAt || null,
      })),
  };
}

/**
 * Saves the list as it looks *before* an edit. Returns the new revision id, or
 * null when the same version is already saved or a burst of the same kind of
 * edit is still coalescing.
 */
function captureListRevision(listId, label, { group = 'item', force = false } = {}) {
  const list = state.lists.find((entry) => entry.id === listId && !entry.deletedAt);
  if (!list) return null;

  const snapshot = snapshotList(list);
  const fingerprint = JSON.stringify(snapshot);
  const record = listHistory.lists[listId] || { revisions: [] };
  const latest = record.revisions[0];

  if (latest) {
    if (latest.fingerprint === fingerprint) return null;

    const windowMs = force ? 0 : HISTORY_WINDOWS[group] || 0;
    const age = Date.now() - Date.parse(latest.savedAt || '');
    if (windowMs && latest.group === group && Number.isFinite(age) && age >= 0 && age < windowMs) {
      return null;
    }
  }

  const revision = {
    id: uid('rev'),
    savedAt: nowIso(),
    label,
    group,
    fingerprint,
    ...snapshot,
  };

  record.revisions = [revision, ...record.revisions].slice(0, HISTORY_LIMIT);
  listHistory.lists[listId] = record;
  pruneListHistory();
  scheduleHistorySave();
  return revision.id;
}

function captureAllLists(label, options) {
  for (const list of state.lists) {
    if (!list.deletedAt) captureListRevision(list.id, label, options);
  }
}

/** Keeps history bounded and drops versions for lists the backup replaced. */
function pruneListHistory() {
  const knownIds = new Set(state.lists.map((entry) => entry.id));
  let changed = false;

  for (const id of Object.keys(listHistory.lists)) {
    if (!knownIds.has(id)) {
      delete listHistory.lists[id];
      changed = true;
    }
  }

  const ids = Object.keys(listHistory.lists);
  if (ids.length > HISTORY_MAX_LISTS) {
    ids
      .sort((a, b) => {
        const timeA = (listHistory.lists[a].revisions[0] || {}).savedAt || '';
        const timeB = (listHistory.lists[b].revisions[0] || {}).savedAt || '';
        return timeB.localeCompare(timeA);
      })
      .slice(HISTORY_MAX_LISTS)
      .forEach((id) => {
        delete listHistory.lists[id];
        changed = true;
      });
  }

  return changed;
}

async function loadListHistory() {
  let stored = null;

  try {
    if (database) {
      stored = await idbGet(database, STORAGE.historyKey);
    } else {
      const raw = localStorage.getItem(
        `${STORAGE.metaLocalStoragePrefix}${STORAGE.historyKey}`
      );
      stored = raw ? JSON.parse(raw) : null;
    }
  } catch (error) {
    console.warn('Could not read saved list versions.', error);
    return;
  }

  if (
    !stored ||
    typeof stored !== 'object' ||
    !stored.lists ||
    typeof stored.lists !== 'object'
  ) {
    return;
  }

  const knownIds = new Set(state.lists.map((entry) => entry.id));
  const lists = {};

  for (const [listId, record] of Object.entries(stored.lists)) {
    if (!knownIds.has(listId) || !record || !Array.isArray(record.revisions)) continue;

    const revisions = record.revisions
      .filter(
        (revision) =>
          revision &&
          typeof revision.id === 'string' &&
          typeof revision.fingerprint === 'string' &&
          Array.isArray(revision.items)
      )
      .slice(0, HISTORY_LIMIT)
      .map((revision) => ({
        ...revision,
        savedAt: typeof revision.savedAt === 'string' ? revision.savedAt : nowIso(),
        label: typeof revision.label === 'string' ? revision.label : 'Earlier version',
        group: typeof revision.group === 'string' ? revision.group : 'structure',
      }));

    if (revisions.length) lists[listId] = { revisions };
  }

  listHistory = { version: 1, lists };
}

function scheduleHistorySave() {
  historyDirty = true;
  if (!ready || storageMode === 'memory') return;

  if (historyTimer) clearTimeout(historyTimer);
  historyTimer = setTimeout(() => {
    historyTimer = null;
    persistHistory();
  }, 400);
}

function persistHistory() {
  if (!historyDirty || !ready || storageMode === 'memory') return Promise.resolve();

  historyDirty = false;
  const payload = listHistory;

  saveChain = saveChain.then(async () => {
    try {
      if (database) {
        await idbPutKey(database, STORAGE.historyKey, payload);
      } else {
        localStorage.setItem(
          `${STORAGE.metaLocalStoragePrefix}${STORAGE.historyKey}`,
          JSON.stringify(payload)
        );
      }
    } catch (error) {
      historyDirty = true;
      console.error('Could not save list versions.', error);
    }
  });

  return saveChain;
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
  return idbPutKey(db, STORAGE.stateKey, value);
}

function idbPutKey(db, key, value) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORAGE.storeName, 'readwrite');
    transaction.objectStore(STORAGE.storeName).put(value, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB write failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB write aborted'));
  });
}

function idbDeleteKey(db, key) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORAGE.storeName, 'readwrite');
    transaction.objectStore(STORAGE.storeName).delete(key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB delete failed'));
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB delete aborted'));
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
