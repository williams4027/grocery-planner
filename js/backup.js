/* JSON backup format and validation.
 *
 * Backups wrap the complete state document so imports can validate the file
 * before replacing anything. Parsing is pure; the store owns the replacement.
 */

import { SCHEMA_VERSION, VERSION } from './config.js';
import { normalizeState, nowIso, summarizeState } from './model.js';

export const BACKUP_FORMAT = 'grocery-planner-backup';
export const BACKUP_VERSION = 1;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function cleanName(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function invalid(message) {
  return new Error(message);
}

function validateList(list, index) {
  if (!isObject(list) || !cleanName(list.name)) {
    throw invalid(`List ${index + 1} in that backup is not valid.`);
  }

  if (list.items !== undefined && !Array.isArray(list.items)) {
    throw invalid(`List “${cleanName(list.name)}” has invalid items.`);
  }

  for (const item of list.items || []) {
    if (!isObject(item) || !cleanName(item.name)) {
      throw invalid(`List “${cleanName(list.name)}” contains an invalid item.`);
    }
  }
}

function validateRecipe(recipe, index) {
  if (!isObject(recipe) || !cleanName(recipe.title)) {
    throw invalid(`Recipe ${index + 1} in that backup is not valid.`);
  }

  if (recipe.ingredients !== undefined && !Array.isArray(recipe.ingredients)) {
    throw invalid(`Recipe “${cleanName(recipe.title)}” has invalid ingredients.`);
  }

  for (const ingredient of recipe.ingredients || []) {
    if (!isObject(ingredient) || !cleanName(ingredient.name)) {
      throw invalid(`Recipe “${cleanName(recipe.title)}” contains an invalid ingredient.`);
    }
  }
}

function validateState(state) {
  if (!Array.isArray(state.lists) || !state.lists.length) {
    throw invalid('That backup is missing its lists.');
  }

  state.lists.forEach(validateList);

  if (state.recipes !== undefined) {
    if (!Array.isArray(state.recipes)) {
      throw invalid('That backup has an invalid recipe list.');
    }
    state.recipes.forEach(validateRecipe);
  }

  if (state.plan !== undefined && !Array.isArray(state.plan)) {
    throw invalid('That backup has an invalid meal plan.');
  }

  if (state.settings !== undefined && !isObject(state.settings)) {
    throw invalid('That backup has invalid settings.');
  }

  if (state.schemaVersion !== undefined) {
    const schemaVersion = Number(state.schemaVersion);
    if (!Number.isFinite(schemaVersion) || schemaVersion < 0) {
      throw invalid('That backup has an invalid data version.');
    }
    if (schemaVersion > SCHEMA_VERSION) {
      throw invalid('That backup was made by a newer version of Grocery Planner.');
    }
  }
}

/** Builds a JSON-safe backup of the current state. */
export function createBackup(state) {
  const exportedAt = nowIso();
  const snapshot = clone(state);
  snapshot.settings.lastExportAt = exportedAt;

  return {
    format: BACKUP_FORMAT,
    formatVersion: BACKUP_VERSION,
    schemaVersion: state.schemaVersion,
    appVersion: VERSION,
    exportedAt,
    state: snapshot,
  };
}

/** Parses JSON text and returns a validated backup summary. */
export function readBackup(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text).replace(/^\uFEFF/, ''));
  } catch (error) {
    throw invalid('That file is not valid JSON.');
  }

  return parseBackup(parsed);
}

/**
 * Accepts a backup envelope (or a bare state document for older exports).
 * Normalizes the state only after all structural checks pass, so a corrupt
 * file cannot partially replace the user's data.
 */
export function parseBackup(input) {
  if (!isObject(input)) {
    throw invalid('That file does not contain a Grocery Planner backup.');
  }

  if (input.format !== undefined && input.format !== BACKUP_FORMAT) {
    throw invalid('That file is not a Grocery Planner backup.');
  }

  if (input.formatVersion !== undefined) {
    const formatVersion = Number(input.formatVersion);
    if (!Number.isInteger(formatVersion) || formatVersion < 1) {
      throw invalid('That backup has an unsupported format.');
    }
    if (formatVersion > BACKUP_VERSION) {
      throw invalid('That backup was made by a newer version of Grocery Planner.');
    }
  }

  const rawState = input.state === undefined ? input : input.state;
  if (!isObject(rawState)) {
    throw invalid('That backup is missing its data.');
  }

  validateState(rawState);

  let state;
  try {
    state = normalizeState(rawState);
  } catch (error) {
    throw invalid(`That backup could not be read: ${error.message}.`);
  }

  const exportedAt =
    typeof input.exportedAt === 'string' && !Number.isNaN(Date.parse(input.exportedAt))
      ? input.exportedAt
      : null;

  return {
    state,
    summary: summarizeState(state),
    exportedAt,
    appVersion: typeof input.appVersion === 'string' ? input.appVersion : null,
  };
}
