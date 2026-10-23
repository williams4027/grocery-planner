/* Shared constants */

export const APP_NAME = 'Grocery Planner';
export const VERSION = '0.9.7';
export const SCHEMA_VERSION = 1;

/* Default route through a store; each list can reorder its own copy. */
export const AISLES = [
  'Produce',
  'Deli',
  'Meat & Seafood',
  'Dairy',
  'Pantry',
  'Frozen',
  'Bakery',
  'Household',
  'Other',
];

export const RECIPE_CATEGORIES = ['Breakfast', 'Lunch/Dinner', 'Snack', 'Other'];

export const PLAN_SLOTS = ['breakfast', 'lunch', 'dinner'];

export const PLAN_SLOT_LABELS = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
};

/* Store layouts reorder the same aisles; they do not add categories. */
export const STORE_PRESETS = {
  kroger: {
    label: 'Kroger',
    name: 'Kroger',
    aisleOrder: [
      'Produce',
      'Deli',
      'Meat & Seafood',
      'Dairy',
      'Bakery',
      'Pantry',
      'Frozen',
      'Household',
      'Other',
    ],
  },
  wholefoods: {
    label: 'Whole Foods',
    name: 'Whole Foods',
    aisleOrder: [
      'Produce',
      'Bakery',
      'Deli',
      'Meat & Seafood',
      'Dairy',
      'Pantry',
      'Frozen',
      'Household',
      'Other',
    ],
  },
  costco: {
    label: 'Costco',
    name: 'Costco',
    aisleOrder: [
      'Household',
      'Pantry',
      'Frozen',
      'Dairy',
      'Deli',
      'Meat & Seafood',
      'Produce',
      'Bakery',
      'Other',
    ],
  },
  custom: {
    label: 'Custom',
    name: 'Groceries',
    aisleOrder: [...AISLES],
  },
};

export const STORAGE = {
  dbName: 'grocery-planner',
  dbVersion: 1,
  storeName: 'kv',
  stateKey: 'state',
  localStorageKey: 'grocery-planner:state:v1',
};
