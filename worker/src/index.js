/* Grocery Planner sync relay.
 *
 * This Worker deliberately has no plaintext access: the only data it stores is
 * an opaque AES-GCM ciphertext and the IV. The auth hash is derived from the
 * same invitation secret on the phone, so the secret itself is never sent here.
 */

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ID_PATTERN = /^[A-Za-z0-9_-]{20,32}$/;
const HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,50}$/;
const IV_PATTERN = /^[A-Za-z0-9_-]{16,24}$/;
const BLOB_PATTERN = /^[A-Za-z0-9_-]+$/;

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    try {
      return await route(request, env);
    } catch (error) {
      if (error instanceof HttpError) {
        return errorResponse(error.status, error.message, error.extra);
      }

      console.error('Unhandled sync error', error);
      return errorResponse(500, 'Sync service error.');
    }
  },
};

async function route(request, env) {
  const url = new URL(request.url);
  const parts = url.pathname.split('/').filter(Boolean);

  if (parts[0] !== 'v1' || parts[1] !== 'households') {
    throw new HttpError(404, 'Not found.');
  }

  if (parts.length === 2) {
    if (request.method !== 'POST') throw methodNotAllowed('POST');
    return createHousehold(request, env);
  }

  if (parts.length === 4 && parts[3] === 'rev') {
    if (request.method !== 'GET') throw methodNotAllowed('GET');
    return getRevision(request, env, parts[2]);
  }

  if (parts.length === 3) {
    if (request.method === 'GET') {
      return getHousehold(request, env, parts[2]);
    }
    if (request.method === 'PUT') {
      return putHousehold(request, env, parts[2]);
    }
    throw methodNotAllowed('GET, PUT');
  }

  throw new HttpError(404, 'Not found.');
}

async function createHousehold(request, env) {
  const body = await readJson(request);
  const id = requireString(body.id, 'id');
  const authHash = requireString(body.authHash, 'authHash');
  const blob = requireString(body.blob, 'blob');
  const iv = requireString(body.iv, 'iv');

  if (!ID_PATTERN.test(id)) {
    throw new HttpError(400, 'Invalid household id.');
  }
  if (!HASH_PATTERN.test(authHash)) {
    throw new HttpError(400, 'Invalid auth hash.');
  }
  if (!BLOB_PATTERN.test(blob) || blob.length > 1_500_000) {
    throw new HttpError(400, 'Invalid encrypted payload.');
  }
  if (!IV_PATTERN.test(iv)) {
    throw new HttpError(400, 'Invalid IV.');
  }

  const existing = await env.DB.prepare(
    'SELECT id FROM households WHERE id = ?'
  )
    .bind(id)
    .first();

  if (existing) {
    throw new HttpError(409, 'That household already exists.');
  }

  const now = new Date().toISOString();

  try {
    await env.DB.prepare(
      `INSERT INTO households (id, auth_hash, blob, iv, rev, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`
    )
      .bind(id, authHash, blob, iv, now, now)
      .run();
  } catch (error) {
    // A concurrent create won the race.
    if (String(error && error.message).toLowerCase().includes('unique')) {
      throw new HttpError(409, 'That household already exists.');
    }
    throw error;
  }

  return json({ rev: 1 }, 201);
}

async function getRevision(request, env, id) {
  const row = await getRow(env, id);
  await verifyAuth(request, row);

  return json({ rev: row.rev });
}

async function getHousehold(request, env, id) {
  const row = await getRow(env, id, 'auth_hash, rev, blob, iv, updated_at');
  await verifyAuth(request, row);

  return json({
    rev: row.rev,
    blob: row.blob,
    iv: row.iv,
    updatedAt: row.updated_at,
  });
}

async function putHousehold(request, env, id) {
  const row = await getRow(env, id);
  await verifyAuth(request, row);

  const ifMatch = request.headers.get('If-Match');
  const expectedRev = Number(ifMatch);

  if (!Number.isInteger(expectedRev) || expectedRev < 1) {
    throw new HttpError(400, 'If-Match must be a revision number.');
  }

  if (expectedRev !== row.rev) {
    throw new HttpError(409, 'Revision conflict.', { rev: row.rev });
  }

  const body = await readJson(request);
  const blob = requireString(body.blob, 'blob');
  const iv = requireString(body.iv, 'iv');

  if (!BLOB_PATTERN.test(blob) || blob.length > 1_500_000) {
    throw new HttpError(400, 'Invalid encrypted payload.');
  }
  if (!IV_PATTERN.test(iv)) {
    throw new HttpError(400, 'Invalid IV.');
  }

  const now = new Date().toISOString();
  const result = await env.DB.prepare(
    `UPDATE households
     SET blob = ?, iv = ?, rev = rev + 1, updated_at = ?
     WHERE id = ? AND rev = ?`
  )
    .bind(blob, iv, now, id, expectedRev)
    .run();

  if (!result.meta || result.meta.changes !== 1) {
    const current = await getRow(env, id);
    throw new HttpError(409, 'Revision conflict.', { rev: current.rev });
  }

  return json({ rev: expectedRev + 1 });
}

async function getRow(env, id, columns = 'auth_hash, rev') {
  if (!ID_PATTERN.test(id)) {
    throw new HttpError(404, 'Household not found.');
  }

  const row = await env.DB.prepare(
    `SELECT ${columns} FROM households WHERE id = ?`
  )
    .bind(id)
    .first();

  if (!row) {
    throw new HttpError(404, 'Household not found.');
  }

  return row;
}

async function verifyAuth(request, row) {
  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);

  if (!match) {
    throw new HttpError(401, 'Missing authorization.');
  }

  const token = match[1].trim();
  if (!TOKEN_PATTERN.test(token)) {
    throw new HttpError(401, 'Invalid authorization.');
  }

  const hash = await sha256Base64Url(token);
  if (!timingSafeEqual(hash, row.auth_hash)) {
    throw new HttpError(401, 'Invalid authorization.');
  }
}

async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value)
  );
  return bytesToBase64Url(new Uint8Array(digest));
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function timingSafeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  if (left.length !== right.length) return false;

  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function readJson(request) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    throw new HttpError(413, 'Request body is too large.');
  }

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) {
    throw new HttpError(413, 'Request body is too large.');
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed;
  } catch (error) {
    throw new HttpError(400, 'Invalid JSON body.');
  }
}

function requireString(value, name) {
  if (typeof value !== 'string' || !value) {
    throw new HttpError(400, `Missing ${name}.`);
  }
  return value;
}

function methodNotAllowed(allow) {
  const error = new HttpError(405, 'Method not allowed.');
  error.extra = { allow };
  return error;
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function errorResponse(status, message, extra = {}) {
  return json({ error: message, ...extra }, status);
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, If-Match',
    'Access-Control-Max-Age': '86400',
  };
}

class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.extra = extra;
  }
}
