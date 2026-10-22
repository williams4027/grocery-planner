/* State container + persistence.
 *
 * One state document is kept in IndexedDB (localStorage fallback), written
 * with a short debounce. Every mutation notifies subscribers synchronously.
 */

import { RECIPE_CATEGORIES, STORAGE } from './config.js';
import { createBackup as buildBackup, parseBackup, readBackup } from './backup.js';
import {
  createEmptyState,
  createItem,
  createList,
  createRecipe,
  normalizeQty,
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
    .sort((a, b) => {
      const categoryA = RECIPE_CATEGORY_ORDER.get(a.category) ?? RECIPE_CATEGORIES.length;
      const categoryB = RECIPE_CATEGORY_ORDER.get(b.category) ?? RECIPE_CATEGORIES.length;
      if (categoryA !== categoryB) return categoryA - categoryB;
      return a.title.localeCompare(b.title);
    });
}

export function getRecipe(recipeId) {
  return state.recipes.find((recipe) => recipe.id === recipeId && !recipe.deletedAt) || null;
}

export function addRecipe(input) {
  const recipe = createRecipe(input);
  if (!recipe.title) return null;

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
  recipe.updatedAt = nowIso();
  commit();
  return recipe;
}

export function deleteRecipe(recipeId) {
  const recipe = getRecipe(recipeId);
  if (!recipe) return false;

  recipe.deletedAt = nowIso();
  recipe.updatedAt = recipe.deletedAt;
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
    list.items.push(item);
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
  loadError = '';
  if (storageMode !== 'memory') saveError = '';
  commit();

  return {
    summary: summarizeState(state),
    exportedAt: parsed.exportedAt,
  };
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

  list.items.push(item);
  touchList(list);
  commit();
  return item;
}

export function updateItem(listId, itemId, input = {}) {
  const item = findItem(listId, itemId);
  if (!item) return null;

  const name = String(input.name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!name) return null;

  item.name = name;
  if ('qty' in input) item.qty = normalizeQty(input.qty);
  if ('unit' in input) item.unit = String(input.unit || '').trim();
  item.aisle = suggestAisle(name);
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

function ensureRecipeSeed() {
  const currentVersion = Number(state.settings.recipeSeedVersion) || 0;
  if (currentVersion >= RECIPE_SEED_VERSION) return;

  const existingKeys = new Set(
    state.recipes.map((recipe) => recipe.seedKey).filter(Boolean)
  );

  for (const seed of SEED_RECIPES) {
    if (!seed.seedKey || existingKeys.has(seed.seedKey)) continue;
    state.recipes.push(createRecipe(seed));
    existingKeys.add(seed.seedKey);
  }

  state.settings.recipeSeedVersion = RECIPE_SEED_VERSION;
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

function touchList(list) {
  list.updatedAt = nowIso();
}

function touchListById(listId) {
  const list = state.lists.find((entry) => entry.id === listId);
  if (list) touchList(list);
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
