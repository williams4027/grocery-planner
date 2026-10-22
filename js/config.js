/* Shared constants */

export const APP_NAME = 'Grocery Planner';
export const VERSION = '0.4.0';
export const SCHEMA_VERSION = 1;

export const AISLES = [
  'Produce',
  'Meat & Seafood',
  'Dairy',
  'Bakery',
  'Frozen',
  'Pantry',
  'Household',
  'Other',
];

/* Store layouts reorder the same aisles; they do not add categories. */
export const STORE_PRESETS = {
  kroger: {
    label: 'Kroger',
    name: 'Kroger',
    aisleOrder: [
      'Produce',
      'Meat & Seafood',
      'Dairy',
      'Bakery',
      'Frozen',
      'Pantry',
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
      'Meat & Seafood',
      'Dairy',
      'Frozen',
      'Pantry',
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
