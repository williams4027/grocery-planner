/* Optional encrypted device sync.
 *
 * The sync server only stores an invitation-id, an auth hash, and an AES-GCM
 * ciphertext. The invitation code derives both the auth token and the
 * encryption key on the phone; the key itself never leaves the device.
 */

import { STORAGE, SYNC_POLL_MS, SYNC_URL } from './config.js';
import { mergeStates, statesEqual } from './merge.js';
import { normalizeState, nowIso, summarizeState } from './model.js';
import * as store from './store.js';

const CODE_PREFIX = 'gp1';
const CREDENTIALS_VERSION = 1;
const SYNC_BASE = String(SYNC_URL || '').replace(/\/+$/, '');

let credentials = null;
let keys = null;
let initialized = false;
let syncing = false;
let syncPromise = null;
let pollTimer = null;
let pushTimer = null;
let applyingRemote = false;
let unsubscribeStore = null;
let lastRemoteState = null;

const statusListeners = new Set();
const status = {
  state: SYNC_BASE ? 'unpaired' : 'not-configured',
  lastSyncedAt: null,
  lastError: '',
  paired: false,
};

function snapshotState(state) {
  return typeof structuredClone === 'function'
    ? structuredClone(state)
    : JSON.parse(JSON.stringify(state));
}

/* ---------- Public API ---------- */

export function isConfigured() {
  return Boolean(SYNC_BASE);
}

export function isPaired() {
  return Boolean(credentials);
}

export function getStatus() {
  return {
    ...status,
    paired: Boolean(credentials),
    lastSyncedAt: credentials ? credentials.lastSyncedAt : null,
    householdId: credentials ? credentials.householdId : null,
  };
}

export function subscribeStatus(listener) {
  statusListeners.add(listener);
  return () => statusListeners.delete(listener);
}

export function getSharingCode() {
  return credentials
    ? encodeCode(credentials.householdId, credentials.secret)
    : null;
}

export async function initSync() {
  if (initialized) return getStatus();
  initialized = true;

  if (!SYNC_BASE) {
    setStatus('not-configured');
    return getStatus();
  }

  const stored = await store.readMeta(STORAGE.syncKey);
  if (isCredentials(stored)) {
    credentials = stored;
    setStatus('idle');
  } else {
    setStatus('unpaired');
  }

  unsubscribeStore = store.subscribe(() => {
    if (!credentials || applyingRemote) return;
    schedulePush();
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('online', handleOnline);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('pageshow', handleFocus);
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibility);
  }

  if (credentials) {
    startPolling();
    syncNow('startup').catch(() => {});
  }

  return getStatus();
}

/** Creates a new encrypted household and returns its invitation code. */
export async function createHousehold() {
  assertConfigured();
  if (credentials) throw new Error('This phone is already sharing.');

  const householdId = bytesToBase64Url(randomBytes(16));
  const secret = bytesToBase64Url(randomBytes(32));
  const nextKeys = await deriveKeys(householdId, secret);
  const payload = await encryptState(store.getState(), nextKeys, householdId);

  await apiCreate(householdId, nextKeys, payload);

  credentials = {
    version: CREDENTIALS_VERSION,
    householdId,
    secret,
    lastRev: 1,
    lastSyncedAt: nowIso(),
    createdAt: nowIso(),
  };
  keys = nextKeys;

  await saveCredentials();
  lastRemoteState = snapshotState(store.getState());
  setStatus('synced');
  startPolling();
  return encodeCode(householdId, secret);
}

/**
 * Downloads and decrypts a shared household without changing local data.
 * The caller shows the summary, then calls joinHousehold(code).
 */
export async function inspectCode(code) {
  assertConfigured();
  const parsed = parseCode(code);
  const nextKeys = await deriveKeys(parsed.householdId, parsed.secret);
  const remote = await apiGet(parsed.householdId, nextKeys);
  const remoteState = await decryptAndNormalize(
    parsed.householdId,
    remote,
    nextKeys
  );

  return {
    householdId: parsed.householdId,
    rev: remote.rev,
    state: remoteState,
    summary: summarizeState(remoteState),
  };
}

/**
 * Replaces this phone's data with the partner's encrypted snapshot. A local
 * pre-sync snapshot is kept so the change can be undone from More.
 */
export async function joinHousehold(code) {
  assertConfigured();
  if (credentials) throw new Error('This phone is already sharing.');

  const inspected = await inspectCode(code);

  await store.writeMeta(STORAGE.preSyncKey, {
    savedAt: nowIso(),
    state: store.getState(),
  });

  store.applySyncState(inspected.state);

  credentials = {
    version: CREDENTIALS_VERSION,
    householdId: inspected.householdId,
    secret: parseCode(code).secret,
    lastRev: inspected.rev,
    lastSyncedAt: nowIso(),
    createdAt: nowIso(),
  };
  keys = await deriveKeys(credentials.householdId, credentials.secret);
  lastRemoteState = snapshotState(store.getState());

  await saveCredentials();
  setStatus('synced');
  startPolling();

  return {
    summary: summarizeState(store.getState()),
    householdId: credentials.householdId,
  };
}

/** Best-effort sync used by buttons and the polling loop. */
export async function syncNow() {
  if (!SYNC_BASE || !credentials) return { ok: false, skipped: true };
  if (syncing) return syncPromise;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    setStatus('offline');
    return { ok: false, offline: true };
  }

  syncing = true;
  setStatus('syncing');

  syncPromise = performSync()
    .then((result) => {
      syncPromise = null;
      syncing = false;
      return result;
    })
    .catch((error) => {
      syncPromise = null;
      syncing = false;
      const offline =
        typeof navigator !== 'undefined' && navigator.onLine === false;
      setStatus(offline ? 'offline' : 'error', error.message || 'Sync failed.');
      return { ok: false, error };
    });

  return syncPromise;
}

/** Stops sync on this device without touching the encrypted cloud copy. */
export async function disconnectLocal() {
  credentials = null;
  keys = null;
  lastRemoteState = null;
  stopPolling();
  if (pushTimer) {
    clearTimeout(pushTimer);
    pushTimer = null;
  }
  await store.deleteMeta(STORAGE.syncKey);
  setStatus(SYNC_BASE ? 'unpaired' : 'not-configured');
}

export async function restorePreSyncSnapshot() {
  const snapshot = await store.readMeta(STORAGE.preSyncKey);
  if (!snapshot || !snapshot.state) return null;

  await disconnectLocal();
  store.applySyncState(snapshot.state);
  await store.deleteMeta(STORAGE.preSyncKey);

  return {
    savedAt: snapshot.savedAt || null,
    summary: summarizeState(store.getState()),
  };
}

export async function hasPreSyncSnapshot() {
  const snapshot = await store.readMeta(STORAGE.preSyncKey);
  return Boolean(snapshot && snapshot.state);
}

/* ---------- Sync loop ---------- */

async function performSync() {
  const nextKeys = await ensureKeys();
  const localBefore = snapshotState(store.getState());
  const head = await apiGetRev(credentials.householdId, nextKeys);

  // The revision only changes when the other phone writes. A local edit can
  // still need a push at the same revision, so compare actual state too.
  if (
    head.rev === credentials.lastRev &&
    lastRemoteState &&
    statesEqual(localBefore, lastRemoteState)
  ) {
    credentials.lastSyncedAt = nowIso();
    setStatus('synced');
    return { ok: true, changed: false };
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const remote = await apiGet(credentials.householdId, nextKeys);
    const remoteState = await decryptAndNormalize(
      credentials.householdId,
      remote,
      nextKeys
    );
    const localState = store.getState();
    const merged = mergeStates(localState, remoteState);

    let nextState = merged;

    if (!statesEqual(merged, localState)) {
      applyingRemote = true;
      try {
        nextState = store.applySyncState(merged);
      } finally {
        applyingRemote = false;
      }
    }

    if (statesEqual(nextState, remoteState)) {
      credentials.lastRev = remote.rev;
      lastRemoteState = snapshotState(remoteState);
      break;
    }

    const payload = await encryptState(
      nextState,
      nextKeys,
      credentials.householdId
    );

    try {
      const saved = await apiPut(
        credentials.householdId,
        nextKeys,
        payload,
        remote.rev
      );
      credentials.lastRev = saved.rev;
      lastRemoteState = snapshotState(nextState);
      break;
    } catch (error) {
      if (error.status !== 409 || attempt === 2) throw error;
    }
  }

  credentials.lastSyncedAt = nowIso();
  await saveCredentials();
  setStatus('synced');
  return { ok: true, changed: true };
}

function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    syncNow('local-change').catch(() => {});
  }, 1500);
}

function startPolling() {
  stopPolling();
  if (!credentials || typeof document === 'undefined') return;
  if (document.visibilityState !== 'visible') return;

  pollTimer = setInterval(() => {
    syncNow('poll').catch(() => {});
  }, SYNC_POLL_MS);
}

function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function handleOnline() {
  syncNow('online').catch(() => {});
  startPolling();
}

function handleFocus() {
  syncNow('focus').catch(() => {});
}

function handleVisibility() {
  if (document.visibilityState === 'visible') {
    syncNow('visible').catch(() => {});
    startPolling();
  } else {
    stopPolling();
  }
}

/* ---------- State helpers ---------- */

async function ensureKeys() {
  if (!credentials) throw new Error('This phone is not paired.');
  if (!keys) {
    keys = await deriveKeys(credentials.householdId, credentials.secret);
  }
  return keys;
}

async function saveCredentials() {
  if (!credentials) return;
  await store.writeMeta(STORAGE.syncKey, credentials);
}

function isCredentials(value) {
  return Boolean(
    value &&
      value.version === CREDENTIALS_VERSION &&
      typeof value.householdId === 'string' &&
      value.householdId &&
      typeof value.secret === 'string' &&
      value.secret &&
      Number.isInteger(value.lastRev)
  );
}

function assertConfigured() {
  if (!SYNC_BASE) {
    throw new Error('Sync is not configured in this build.');
  }
}

function setStatus(nextState, error = '') {
  status.state = nextState;
  status.lastError = error || '';
  status.paired = Boolean(credentials);
  status.lastSyncedAt = credentials ? credentials.lastSyncedAt : null;

  for (const listener of statusListeners) {
    try {
      listener(getStatus());
    } catch (listenerError) {
      console.error('Sync status listener failed', listenerError);
    }
  }
}

/* ---------- Code + crypto ---------- */

function encodeCode(householdId, secret) {
  return `${CODE_PREFIX}.${householdId}.${secret}`;
}

function parseCode(input) {
  const clean = String(input || '')
    .trim()
    .replace(/\s+/g, '');
  const match = clean.match(
    /^gp1\.([A-Za-z0-9_-]{20,32})\.([A-Za-z0-9_-]{40,50})$/
  );

  if (!match) {
    throw new Error('That sharing code is not valid.');
  }

  return { householdId: match[1], secret: match[2] };
}

function randomBytes(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const clean = String(value || '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const padded = clean + '='.repeat((4 - (clean.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function deriveKeys(householdId, secret) {
  if (!globalThis.crypto || !globalThis.crypto.subtle) {
    throw new Error('This browser does not support encrypted sync.');
  }

  const encoder = new TextEncoder();
  const secretBytes = base64UrlToBytes(secret);
  const baseKey = await crypto.subtle.importKey(
    'raw',
    secretBytes,
    'HKDF',
    false,
    ['deriveBits']
  );
  const salt = encoder.encode(`grocery-planner:${householdId}`);

  const authBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: encoder.encode('gp-auth-v1'),
    },
    baseKey,
    256
  );
  const encryptionBits = await crypto.subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info: encoder.encode('gp-enc-v1'),
    },
    baseKey,
    256
  );

  const authToken = bytesToBase64Url(new Uint8Array(authBits));
  const authHash = bytesToBase64Url(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', encoder.encode(authToken))
    )
  );
  const aesKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(encryptionBits),
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );

  return { authToken, authHash, aesKey };
}

async function encryptState(state, nextKeys, householdId) {
  const encoder = new TextEncoder();
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
      additionalData: encoder.encode(householdId),
    },
    nextKeys.aesKey,
    encoder.encode(JSON.stringify(state))
  );

  return {
    blob: bytesToBase64Url(new Uint8Array(ciphertext)),
    iv: bytesToBase64Url(iv),
  };
}

async function decryptState(householdId, remote, nextKeys) {
  const decoder = new TextDecoder();
  const plaintext = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: base64UrlToBytes(remote.iv),
      additionalData: new TextEncoder().encode(householdId),
    },
    nextKeys.aesKey,
    base64UrlToBytes(remote.blob)
  );

  return JSON.parse(decoder.decode(plaintext));
}

async function decryptAndNormalize(householdId, remote, nextKeys) {
  let parsed;
  try {
    parsed = await decryptState(householdId, remote, nextKeys);
  } catch (error) {
    throw new Error(
      'The shared data could not be decrypted. Check the sharing code and try again.'
    );
  }

  try {
    return normalizeState(parsed);
  } catch (error) {
    throw new Error(
      'The shared data was made by a newer version of Grocery Planner. Update both phones and try again.'
    );
  }
}

/* ---------- HTTP ---------- */

async function apiCreate(householdId, nextKeys, payload) {
  return request(`/v1/households`, {
    method: 'POST',
    body: {
      id: householdId,
      authHash: nextKeys.authHash,
      blob: payload.blob,
      iv: payload.iv,
    },
  });
}

async function apiGetRev(householdId, nextKeys) {
  return request(`/v1/households/${encodeURIComponent(householdId)}/rev`, {
    headers: { Authorization: `Bearer ${nextKeys.authToken}` },
  });
}

async function apiGet(householdId, nextKeys) {
  return request(`/v1/households/${encodeURIComponent(householdId)}`, {
    headers: { Authorization: `Bearer ${nextKeys.authToken}` },
  });
}

async function apiPut(householdId, nextKeys, payload, rev) {
  return request(`/v1/households/${encodeURIComponent(householdId)}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${nextKeys.authToken}`,
      'If-Match': String(rev),
    },
    body: { blob: payload.blob, iv: payload.iv },
  });
}

async function request(path, { method = 'GET', headers = {}, body = null } = {}) {
  let response;
  try {
    response = await fetch(`${SYNC_BASE}${path}`, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });
  } catch (error) {
    const offline =
      typeof navigator !== 'undefined' && navigator.onLine === false;
    const wrapped = new Error(
      offline
        ? 'You are offline. Changes are saved on this phone and will sync later.'
        : 'Could not reach the sync service.'
    );
    wrapped.cause = error;
    throw wrapped;
  }

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const message =
      response.status === 401
        ? 'This phone is not authorized for the shared data. Rejoin with the sharing code.'
        : response.status === 404
          ? 'The shared copy no longer exists.'
          : response.status === 409
            ? 'Another phone changed the data first.'
            : (data && data.error) || 'Sync request failed.';
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }

  return data || {};
}
