/* Data model, defaults, and pure helpers. No DOM, no persistence. */

import { AISLES, SCHEMA_VERSION, STORE_PRESETS } from './config.js';

const AISLE_KEYWORDS = [
  ['Frozen', ['frozen', 'ice cream', 'popsicle', 'frozen pizza']],
  ['Meat & Seafood', ['chicken', 'beef', 'pork', 'turkey', 'lamb', 'bacon', 'sausage', 'ham', 'steak', 'ground', 'fish', 'salmon', 'tuna', 'shrimp', 'prawn', 'cod', 'tilapia', 'deli']],
  ['Produce', ['apple', 'banana', 'orange', 'lemon', 'lime', 'avocado', 'tomato', 'potato', 'onion', 'garlic', 'carrot', 'celery', 'cucumber', 'pepper', 'lettuce', 'spinach', 'kale', 'broccoli', 'cauliflower', 'mushroom', 'zucchini', 'squash', 'berry', 'grape', 'melon', 'peach', 'pear', 'plum', 'mango', 'pineapple', 'herb', 'cilantro', 'parsley', 'basil', 'thyme', 'rosemary', 'ginger', 'scallion', 'corn', 'cabbage', 'asparagus', 'radish', 'beet', 'eggplant']],
  ['Dairy', ['milk', 'cheese', 'yogurt', 'yoghurt', 'butter', 'cream', 'egg', 'cottage', 'mozzarella', 'parmesan', 'cheddar']],
  ['Bakery', ['bread', 'bagel', 'tortilla', 'bun', 'roll', 'baguette', 'pita', 'croissant', 'muffin', 'english muffin']],
  ['Pantry', ['rice', 'pasta', 'noodle', 'bean', 'lentil', 'can', 'canned', 'oil', 'vinegar', 'sauce', 'salsa', 'ketchup', 'mustard', 'mayo', 'spice', 'seasoning', 'salt', 'flour', 'sugar', 'cereal', 'oat', 'coffee', 'tea', 'peanut butter', 'almond butter', 'stock', 'broth', 'honey', 'syrup', 'chocolate', 'cracker', 'chip', 'snack', 'nut', 'peanut', 'almond', 'raisin', 'granola', 'jam', 'jelly']],
  ['Household', ['soap', 'detergent', 'shampoo', 'conditioner', 'toothpaste', 'toothbrush', 'deodorant', 'paper towel', 'toilet paper', 'tissue', 'trash bag', 'garbage bag', 'foil', 'plastic wrap', 'parchment', 'cleaner', 'bleach', 'sponge', 'dish', 'laundry', 'battery', 'light bulb', 'razor', 'lotion', 'sunscreen', 'medicine', 'vitamin']],
];

export function uid(prefix = 'id') {
  const cryptoObj = globalThis.crypto;
  const raw =
    cryptoObj && typeof cryptoObj.randomUUID === 'function'
      ? cryptoObj.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${raw}`;
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeQty(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.round(number * 1000) / 1000;
}

export function suggestAisle(name) {
  const text = ` ${String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()} `;

  for (const [aisle, words] of AISLE_KEYWORDS) {
    for (const word of words) {
      if (text.includes(` ${word} `) || text.includes(` ${word}s `)) {
        return aisle;
      }
    }
  }

  return 'Other';
}

/** Keeps every known aisle once, in the supplied order, then fills in the rest. */
export function normalizeAisleOrder(input) {
  const provided = Array.isArray(input) ? input.filter((aisle) => AISLES.includes(aisle)) : [];
  return [...new Set([...provided, ...AISLES])];
}

function normalizeStoreKey(value) {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(STORE_PRESETS, value)
    ? value
    : 'custom';
}

export function createList(name = 'Groceries', { storeKey = 'custom', aisleOrder = null } = {}) {
  const timestamp = nowIso();
  const key = normalizeStoreKey(storeKey);
  const preset = STORE_PRESETS[key];

  return {
    id: uid('lst'),
    name: String(name || '').trim() || preset.name,
    storeKey: key,
    aisleOrder: normalizeAisleOrder(aisleOrder || preset.aisleOrder),
    createdAt: timestamp,
    updatedAt: timestamp,
    archivedAt: null,
    items: [],
  };
}

export function createItem({ name, qty = null, unit = '', aisle = null } = {}) {
  const cleanName = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
  const timestamp = nowIso();

  return {
    id: uid('itm'),
    name: cleanName,
    qty: normalizeQty(qty),
    unit: String(unit || '').trim(),
    aisle: AISLES.includes(aisle) ? aisle : suggestAisle(cleanName),
    checked: false,
    note: null,
    sourceRecipeId: null,
    addedAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function createEmptyState() {
  const timestamp = nowIso();
  const list = createList('Groceries');
  const settings = defaultSettings();
  settings.activeListId = list.id;

  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt: timestamp,
    updatedAt: timestamp,
    lists: [list],
    recipes: [],
    plan: [],
    settings,
  };
}

function defaultSettings() {
  return {
    weekStart: 'sun',
    aisleOrder: [...AISLES],
    activeListId: null,
    theme: 'system',
    lastExportAt: null,
    backupNudgeDays: 14,
  };
}

function normalizeSettings(input) {
  const settings = input && typeof input === 'object' ? input : {};
  const provided = Array.isArray(settings.aisleOrder)
    ? settings.aisleOrder.filter((aisle) => AISLES.includes(aisle))
    : [];

  return {
    weekStart: settings.weekStart === 'mon' ? 'mon' : 'sun',
    aisleOrder: normalizeAisleOrder(provided),
    activeListId:
      typeof settings.activeListId === 'string' && settings.activeListId
        ? settings.activeListId
        : null,
    theme: ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system',
    lastExportAt: typeof settings.lastExportAt === 'string' ? settings.lastExportAt : null,
    backupNudgeDays:
      Number.isFinite(settings.backupNudgeDays) && settings.backupNudgeDays > 0
        ? settings.backupNudgeDays
        : 14,
  };
}

function normalizeItem(input) {
  if (!input || typeof input !== 'object') return null;

  const name = String(input.name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!name) return null;

  const timestamp = nowIso();
  const addedAt = typeof input.addedAt === 'string' ? input.addedAt : timestamp;

  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('itm'),
    name,
    qty: normalizeQty(input.qty),
    unit: String(input.unit || '').trim(),
    aisle: AISLES.includes(input.aisle) ? input.aisle : suggestAisle(name),
    checked: Boolean(input.checked),
    note: typeof input.note === 'string' && input.note ? input.note : null,
    sourceRecipeId:
      typeof input.sourceRecipeId === 'string' && input.sourceRecipeId
        ? input.sourceRecipeId
        : null,
    addedAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : addedAt,
    deletedAt: typeof input.deletedAt === 'string' ? input.deletedAt : null,
  };
}

function normalizeList(input, fallbackAisleOrder = null) {
  if (!input || typeof input !== 'object') return null;

  const timestamp = nowIso();
  const items = Array.isArray(input.items)
    ? input.items.map(normalizeItem).filter(Boolean)
    : [];
  const storeKey = normalizeStoreKey(input.storeKey);
  const preset = STORE_PRESETS[storeKey];
  const aisleOrder =
    Array.isArray(input.aisleOrder) && input.aisleOrder.length
      ? input.aisleOrder
      : fallbackAisleOrder || preset.aisleOrder;

  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('lst'),
    name: String(input.name || '').trim() || preset.name,
    storeKey,
    aisleOrder: normalizeAisleOrder(aisleOrder),
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : timestamp,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : timestamp,
    archivedAt: typeof input.archivedAt === 'string' ? input.archivedAt : null,
    items,
  };
}

/**
 * Accepts a parsed state document and returns a valid one.
 * Throws when the document is unusable or was written by a newer schema.
 */
export function normalizeState(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('State is not an object');
  }

  const version = Number(input.schemaVersion) || SCHEMA_VERSION;
  if (version > SCHEMA_VERSION) {
    throw new Error('This data was written by a newer version of the app');
  }

  const timestamp = nowIso();
  const settings = normalizeSettings(input.settings);
  const lists = Array.isArray(input.lists)
    ? input.lists.map((list) => normalizeList(list, settings.aisleOrder)).filter(Boolean)
    : [];

  const state = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : timestamp,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : timestamp,
    lists,
    recipes: Array.isArray(input.recipes) ? input.recipes : [],
    plan: Array.isArray(input.plan) ? input.plan : [],
    settings,
  };

  if (!state.lists.length) {
    const list = createList('Groceries');
    state.lists.push(list);
    state.settings.activeListId = list.id;
    return state;
  }

  const active = state.lists.find(
    (list) => list.id === state.settings.activeListId && !list.archivedAt
  );
  if (!active) {
    const firstVisible = state.lists.find((list) => !list.archivedAt) || state.lists[0];
    state.settings.activeListId = firstVisible.id;
  }

  return state;
}
