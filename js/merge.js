/* Deterministic state merge for encrypted device sync and backup merging.
 *
 * Both devices start from the same snapshot (the second phone replaces its
 * local data when it joins), so entities can be matched by their existing ids.
 * When the same entity changed on both phones, the newer updatedAt wins. Equal
 * timestamps fall back to a stable serialization so both phones converge.
 */

import { SCHEMA_VERSION } from './config.js';
import { normalizeState } from './model.js';

const SHARED_SETTINGS = ['weekStart', 'aisleOrder'];

function timeOf(value) {
  if (!value) return 0;
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value !== 'object') return 0;

  let newest = 0;
  for (const field of [
    'updatedAt',
    'deletedAt',
    'archivedAt',
    'addedAt',
    'createdAt',
  ]) {
    const parsed = Date.parse(value[field]);
    if (!Number.isNaN(parsed) && parsed > newest) newest = parsed;
  }
  return newest;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function pickNewer(a, b) {
  if (!a) return b;
  if (!b) return a;

  const timeA = timeOf(a);
  const timeB = timeOf(b);
  if (timeA !== timeB) return timeA > timeB ? a : b;

  return stableStringify(a) >= stableStringify(b) ? a : b;
}

function compareCreated(a, b) {
  const createdA = Date.parse(a && a.createdAt) || 0;
  const createdB = Date.parse(b && b.createdAt) || 0;
  if (createdA !== createdB) return createdA - createdB;
  return String(a && a.id).localeCompare(String(b && b.id));
}

function comparePlan(a, b) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  if (a.slot !== b.slot) return a.slot.localeCompare(b.slot);
  return String(a.id).localeCompare(String(b.id));
}

function compareTombstone(a, b) {
  if (a.date !== b.date) return a.date.localeCompare(b.date);
  return a.slot.localeCompare(b.slot);
}

function latestIso(a, b) {
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  if (Number.isNaN(timeA)) return Number.isNaN(timeB) ? a : b;
  if (Number.isNaN(timeB)) return a;
  return timeA >= timeB ? a : b;
}

function earliestIso(a, b) {
  const timeA = Date.parse(a);
  const timeB = Date.parse(b);
  if (Number.isNaN(timeA)) return Number.isNaN(timeB) ? a : b;
  if (Number.isNaN(timeB)) return a;
  return timeA <= timeB ? a : b;
}

function mergeItems(localItems, remoteItems) {
  const merged = new Map();

  for (const item of [...localItems, ...remoteItems]) {
    if (!item || !item.id) continue;
    const existing = merged.get(item.id);
    merged.set(item.id, pickNewer(existing, item));
  }

  return [...merged.values()].sort(compareCreated);
}

function mergeLists(localLists, remoteLists) {
  const merged = new Map();

  for (const list of [...localLists, ...remoteLists]) {
    if (!list || !list.id) continue;

    const existing = merged.get(list.id);
    if (!existing) {
      merged.set(list.id, {
        ...list,
        items: mergeItems([], list.items || []),
      });
      continue;
    }

    const metadata = pickNewer(existing, list);
    merged.set(list.id, {
      ...metadata,
      items: mergeItems(existing.items || [], list.items || []),
      updatedAt: latestIso(existing.updatedAt, list.updatedAt),
    });
  }

  return [...merged.values()].sort(compareCreated);
}

function mergeRecipes(localRecipes, remoteRecipes) {
  const merged = new Map();

  for (const recipe of [...localRecipes, ...remoteRecipes]) {
    if (!recipe || !recipe.id) continue;
    const existing = merged.get(recipe.id);
    merged.set(recipe.id, pickNewer(existing, recipe));
  }

  return [...merged.values()].sort(compareCreated);
}

function mergePlan(localState, remoteState) {
  const live = new Map();

  for (const entry of [...(localState.plan || []), ...(remoteState.plan || [])]) {
    if (!entry || !entry.date || !entry.slot) continue;
    const key = `${entry.date}:${entry.slot}`;
    live.set(key, pickNewer(live.get(key), entry));
  }

  const tombstones = new Map();
  for (const tombstone of [
    ...(localState.planTombstones || []),
    ...(remoteState.planTombstones || []),
  ]) {
    if (!tombstone || !tombstone.date || !tombstone.slot) continue;
    const key = `${tombstone.date}:${tombstone.slot}`;
    tombstones.set(key, pickNewer(tombstones.get(key), tombstone));
  }

  for (const [key, tombstone] of [...tombstones.entries()]) {
    const entry = live.get(key);
    if (!entry) continue;

    if (tombstone.deletedAt >= entry.updatedAt) live.delete(key);
    else tombstones.delete(key);
  }

  return {
    plan: [...live.values()].sort(comparePlan),
    planTombstones: [...tombstones.values()].sort(compareTombstone),
  };
}

function mergeSettings(localSettings, remoteSettings) {
  const local = localSettings && typeof localSettings === 'object' ? localSettings : {};
  const remote = remoteSettings && typeof remoteSettings === 'object' ? remoteSettings : {};
  const newer = pickNewer(local, remote);
  const merged = { ...local };

  for (const field of SHARED_SETTINGS) {
    if (newer[field] !== undefined) merged[field] = newer[field];
  }

  merged.updatedAt = latestIso(local.updatedAt, remote.updatedAt);
  return merged;
}

/**
 * Merges two normalized state documents without mutating either input.
 * The result is normalized again so tombstones and duplicate plan slots are
 * resolved consistently.
 */
export function mergeStates(local, remote) {
  if (!local) return normalizeState(remote);
  if (!remote) return normalizeState(local);

  const plan = mergePlan(local, remote);

  return normalizeState({
    schemaVersion: SCHEMA_VERSION,
    createdAt: earliestIso(local.createdAt, remote.createdAt),
    updatedAt: latestIso(local.updatedAt, remote.updatedAt),
    lists: mergeLists(local.lists || [], remote.lists || []),
    recipes: mergeRecipes(local.recipes || [], remote.recipes || []),
    plan: plan.plan,
    planTombstones: plan.planTombstones,
    settings: mergeSettings(local.settings, remote.settings),
  });
}

/** Stable comparison used to avoid redundant sync pushes. */
export function statesEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}
