/* Shared constants */

export const APP_NAME = 'Grocery Planner';
export const VERSION = '0.3.0';
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

export const STORAGE = {
  dbName: 'grocery-planner',
  dbVersion: 1,
  storeName: 'kv',
  stateKey: 'state',
  localStorageKey: 'grocery-planner:state:v1',
};
