/* Data model, defaults, and pure helpers. No DOM, no persistence. */

import {
  AISLES,
  PLAN_SLOTS,
  RECIPE_CATEGORIES,
  SCHEMA_VERSION,
  STORE_PRESETS,
} from './config.js';
import { isValidDateKey } from './dates.js';

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

/**
 * Planned-meal quantities are tracked per plan entry so one meal can be
 * cleared without disturbing another meal's contribution to the same row.
 * Zero is valid here: a plan ingredient without a quantity still needs a row.
 */
function normalizePlanContributions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;

  const contributions = {};
  for (const [entryId, value] of Object.entries(input)) {
    if (typeof entryId !== 'string' || !entryId) continue;
    const qty = value === null || value === '' ? 0 : Number(value);
    if (!Number.isFinite(qty) || qty < 0) continue;
    contributions[entryId] = Math.round(qty * 1000) / 1000;
  }

  return Object.keys(contributions).length ? contributions : null;
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

export function createItem({
  name,
  qty = null,
  unit = '',
  aisle = null,
  sourceRecipeId = null,
  sourcePlanEntryId = null,
  planContributions = null,
} = {}) {
  const cleanName = String(name || '')
    .trim()
    .replace(/\s+/g, ' ');
  const timestamp = nowIso();
  const normalizedQty = normalizeQty(qty);
  const planEntryId =
    typeof sourcePlanEntryId === 'string' && sourcePlanEntryId
      ? sourcePlanEntryId
      : null;
  const normalizedContributions =
    normalizePlanContributions(planContributions) ||
    (planEntryId ? { [planEntryId]: Number(normalizedQty) || 0 } : null);
  const contributionIds = normalizedContributions
    ? Object.keys(normalizedContributions)
    : [];

  return {
    id: uid('itm'),
    name: cleanName,
    qty: normalizedQty,
    unit: String(unit || '').trim(),
    aisle: AISLES.includes(aisle) ? aisle : suggestAisle(cleanName),
    checked: false,
    note: null,
    sourceRecipeId:
      typeof sourceRecipeId === 'string' && sourceRecipeId ? sourceRecipeId : null,
    sourcePlanEntryId:
      contributionIds.length === 1 ? contributionIds[0] : null,
    planContributions: normalizedContributions,
    addedAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

const UNICODE_FRACTIONS = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
};

const INGREDIENT_UNITS =
  /^(cups?|tbsp|tsp|lbs?|oz|g|kg|ml|l|cloves?|cans?|cartons?|slices?|bunch(?:es)?|bags?|packs?|jars?|bottles?|boxes?|pinch(?:es)?|dash(?:es)?|sticks?|heads?|sprigs?|fillets?|pieces?)\b\s+(.+)$/i;

function quantityValue(token) {
  if (UNICODE_FRACTIONS[token] !== undefined) return UNICODE_FRACTIONS[token];

  if (token.includes(' ')) {
    const [whole, fraction] = token.split(/\s+/);
    const fractionValue = quantityValue(fraction);
    return Number(whole) + fractionValue;
  }

  if (token.includes('/')) {
    const [numerator, denominator] = token.split('/').map(Number);
    return denominator ? numerator / denominator : NaN;
  }

  return Number(token);
}

/**
 * Splits a recipe line like "1 1/2 cups chopped carrots" into quantity, unit,
 * and the item name used by the grocery list. Lines without a recognised unit
 * stay whole, so "1 small onion" is not mangled into a bare "small onion".
 */
export function parseIngredientLine(line) {
  const raw = String(line || '')
    .trim()
    .replace(/^[-•*]\s*/, '')
    .replace(/\s+/g, ' ');
  if (!raw) return { name: '', qty: null, unit: '' };

  const text = raw.replace(
    /^(\d+)\s+([¼½¾⅓⅔⅛⅜⅝⅞])\s+/,
    (_, whole, fraction) => `${Number(whole) + UNICODE_FRACTIONS[fraction]} `
  );

  const quantityMatch = text.match(
    /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|[¼½¾⅓⅔⅛⅜⅝⅞])\s+(.+)$/
  );
  if (!quantityMatch) return { name: raw, qty: null, unit: '' };

  const qty = normalizeQty(quantityValue(quantityMatch[1]));
  const unitMatch = quantityMatch[2].match(INGREDIENT_UNITS);
  if (!unitMatch) return { name: raw, qty: null, unit: '' };

  return {
    name: unitMatch[2].trim(),
    qty,
    unit: unitMatch[1],
  };
}

function normalizeIngredient(input) {
  const source = typeof input === 'string' ? parseIngredientLine(input) : input;
  if (!source || typeof source !== 'object') return null;

  const name = String(source.name || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!name) return null;

  return {
    name,
    qty: normalizeQty(source.qty),
    unit: String(source.unit || '').trim(),
    aisle: AISLES.includes(source.aisle) ? source.aisle : suggestAisle(name),
  };
}

function normalizeRecipeCategory(value) {
  if (RECIPE_CATEGORIES.includes(value)) return value;

  const clean = String(value || '')
    .trim()
    .toLowerCase();
  if (clean === 'breakfast') return 'Breakfast';
  if (clean === 'snack' || clean === 'dessert') return 'Snack';
  if (clean.includes('lunch') || clean.includes('dinner') || clean === 'main') {
    return 'Lunch/Dinner';
  }
  return 'Other';
}

export function normalizeServings(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 4;
  return Math.max(1, Math.round(number));
}

function normalizeSteps(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((step) => String(step || '').trim())
    .filter(Boolean);
}

export function createRecipe({
  title,
  category = 'Lunch/Dinner',
  servings = 4,
  ingredients = [],
  steps = [],
  notes = '',
  sourceUrl = null,
  seedKey = null,
} = {}) {
  const timestamp = nowIso();

  return {
    id: uid('rcp'),
    title:
      String(title || '')
        .trim()
        .replace(/\s+/g, ' ') || 'Untitled recipe',
    category: normalizeRecipeCategory(category),
    servings: normalizeServings(servings),
    ingredients: Array.isArray(ingredients)
      ? ingredients.map(normalizeIngredient).filter(Boolean)
      : [],
    steps: normalizeSteps(steps),
    notes: String(notes || '').trim(),
    sourceUrl: typeof sourceUrl === 'string' && sourceUrl ? sourceUrl : null,
    seedKey: typeof seedKey === 'string' && seedKey ? seedKey : null,
    createdAt: timestamp,
    updatedAt: timestamp,
    deletedAt: null,
  };
}

export function createPlanEntry({
  date,
  slot,
  recipeId = null,
  title = '',
  servings = null,
} = {}) {
  const timestamp = nowIso();

  return {
    id: uid('pln'),
    date: String(date || '').trim(),
    slot: String(slot || '').trim().toLowerCase(),
    recipeId:
      typeof recipeId === 'string' && recipeId ? recipeId : null,
    title: String(title || '')
      .trim()
      .replace(/\s+/g, ' '),
    servings: normalizeServings(servings),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function normalizePlanEntry(input) {
  if (!input || typeof input !== 'object') return null;

  const date = String(input.date || '').trim();
  const slot = String(input.slot || '')
    .trim()
    .toLowerCase();
  if (!isValidDateKey(date) || !PLAN_SLOTS.includes(slot)) return null;

  const timestamp = nowIso();
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : timestamp;
  const recipeId =
    typeof input.recipeId === 'string' && input.recipeId ? input.recipeId : null;
  const title = String(input.title || '')
    .trim()
    .replace(/\s+/g, ' ');

  if (!recipeId && !title) return null;

  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('pln'),
    date,
    slot,
    recipeId,
    title,
    servings: normalizeServings(input.servings),
    createdAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : createdAt,
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
    recipeSeedVersion: 0,
    itemMergeVersion: 0,
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
    recipeSeedVersion:
      Number.isFinite(settings.recipeSeedVersion) && settings.recipeSeedVersion >= 0
        ? settings.recipeSeedVersion
        : 0,
    itemMergeVersion:
      Number.isFinite(settings.itemMergeVersion) && settings.itemMergeVersion >= 0
        ? settings.itemMergeVersion
        : 0,
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
  const qty = normalizeQty(input.qty);
  const requestedPlanEntryId =
    typeof input.sourcePlanEntryId === 'string' && input.sourcePlanEntryId
      ? input.sourcePlanEntryId
      : null;
  const planContributions =
    normalizePlanContributions(input.planContributions) ||
    (requestedPlanEntryId
      ? { [requestedPlanEntryId]: Number(qty) || 0 }
      : null);
  const contributionIds = planContributions
    ? Object.keys(planContributions)
    : [];
  const sourcePlanEntryId =
    contributionIds.length === 1 ? contributionIds[0] : null;

  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('itm'),
    name,
    qty,
    unit: String(input.unit || '').trim(),
    aisle: AISLES.includes(input.aisle) ? input.aisle : suggestAisle(name),
    checked: Boolean(input.checked),
    note: typeof input.note === 'string' && input.note ? input.note : null,
    sourceRecipeId:
      typeof input.sourceRecipeId === 'string' && input.sourceRecipeId
        ? input.sourceRecipeId
        : null,
    sourcePlanEntryId,
    planContributions,
    addedAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : addedAt,
    deletedAt: typeof input.deletedAt === 'string' ? input.deletedAt : null,
  };
}

function normalizeRecipe(input) {
  if (!input || typeof input !== 'object') return null;

  const title = String(input.title || '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!title) return null;

  const timestamp = nowIso();
  const createdAt = typeof input.createdAt === 'string' ? input.createdAt : timestamp;

  return {
    id: typeof input.id === 'string' && input.id ? input.id : uid('rcp'),
    title,
    category: normalizeRecipeCategory(input.category),
    servings: normalizeServings(input.servings),
    ingredients: Array.isArray(input.ingredients)
      ? input.ingredients.map(normalizeIngredient).filter(Boolean)
      : [],
    steps: normalizeSteps(input.steps),
    notes: String(input.notes || '').trim(),
    sourceUrl: typeof input.sourceUrl === 'string' && input.sourceUrl ? input.sourceUrl : null,
    seedKey: typeof input.seedKey === 'string' && input.seedKey ? input.seedKey : null,
    createdAt,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : createdAt,
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

  const plan = [];
  const planKeys = new Set();
  for (const rawEntry of Array.isArray(input.plan) ? input.plan : []) {
    const entry = normalizePlanEntry(rawEntry);
    if (!entry) continue;

    const key = `${entry.date}:${entry.slot}`;
    if (planKeys.has(key)) continue;
    planKeys.add(key);
    plan.push(entry);
  }

  const state = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: typeof input.createdAt === 'string' ? input.createdAt : timestamp,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : timestamp,
    lists,
    recipes: Array.isArray(input.recipes)
      ? input.recipes.map(normalizeRecipe).filter(Boolean)
      : [],
    plan,
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

export function summarizeState(input) {
  const lists = input && Array.isArray(input.lists) ? input.lists : [];
  const items = lists.reduce((count, list) => {
    if (!list || !Array.isArray(list.items)) return count;
    return (
      count +
      list.items.filter((item) => item && !item.deletedAt && item.name).length
    );
  }, 0);
  const recipes =
    input && Array.isArray(input.recipes)
      ? input.recipes.filter((recipe) => recipe && !recipe.deletedAt && recipe.title).length
      : 0;

  const plan =
    input && Array.isArray(input.plan)
      ? input.plan.filter((entry) => entry && entry.date && entry.slot).length
      : 0;

  return { lists: lists.length, items, recipes, plan };
}
