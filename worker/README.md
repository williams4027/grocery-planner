# Encrypted sync relay

This is a small Cloudflare Worker plus D1 database that relays one encrypted
snapshot per household. It has no accounts and never receives the encryption
key or plaintext.

## What the server can see

- A random household id
- A SHA-256 auth hash derived from the invitation secret
- One AES-256-GCM ciphertext and its IV
- A revision number and timestamps

The invitation code (`gp1.<household>.<secret>`) is shown only on the phone
that creates the household. The other phone pastes it into **More → Join with
code**. Deriving different auth and encryption keys from that secret happens
on the phones with HKDF.

## Deploy

Requires Node 20+.
From this directory:

```bash
npx wrangler@latest login
npx wrangler@latest d1 create grocery-planner-sync
```

Copy the `database_id` into `wrangler.toml`, then:

```bash
npx wrangler@latest d1 execute grocery-planner-sync --remote --file=./schema.sql
npx wrangler@latest deploy
```

If `deploy` says you need to register a `workers.dev` subdomain, open
`https://dash.cloudflare.com/<account-id>/workers/onboarding`, choose a subdomain, and run deploy
again. A brand-new account subdomain can take a while to get its TLS certificate; HTTP reaches the
Worker before HTTPS does. If HTTPS still fails after 24 hours, change the subdomain in the
dashboard or use a custom domain.

For local-only development:

```bash
npx wrangler@latest d1 execute grocery-planner-sync --local --file=./schema.sql
npx wrangler@latest dev
```

## Point the app at the Worker

After deploying, copy the Worker URL (for example
`https://grocery-planner-sync.your-subdomain.workers.dev`) into
`js/config.js`:

```js
export const SYNC_URL = 'https://grocery-planner-sync.your-subdomain.workers.dev';
```

Redeploy the static app (or refresh the service worker cache) on both phones.
The URL is not a secret; the invitation code is.

## API

All encrypted endpoints use `Authorization: Bearer <authToken>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `POST` | `/v1/households` | Create a household with `{ id, authHash, blob, iv }` |
| `GET` | `/v1/households/:id/rev` | Read just the revision |
| `GET` | `/v1/households/:id` | Read `{ rev, blob, iv, updatedAt }` |
| `PUT` | `/v1/households/:id` | Replace ciphertext; requires `If-Match: <rev>` |

A `409` means another phone wrote first. The app re-reads, merges, and retries.
There is intentionally no delete endpoint yet. Resetting or restoring a local
backup turns sharing off on that phone but leaves the encrypted cloud copy
alone.

## Cost and limits

D1 and Workers have free tiers that are far above what two phones need. The
Worker caps request bodies at 2 MB and stores one row per household. The app
polls the revision once a minute only while the More screen is open, and
pushes 1.5 seconds after a local edit.
