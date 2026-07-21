# Deploy Reconcile to Fly.io

Prereqs done in the repo: Postgres Prisma schema + init migration, `Dockerfile`
(Node 20), `fly.toml`, `.dockerignore` (excludes `.env`). You need a Fly account
(free allowance; requires a card on file).

## 1. Log in (you — needs a browser)

```bash
flyctl auth login
```

## 2. Create the app + Postgres

```bash
cd ~/Documents/GitHub/shopify-apps/reconcile

# Create the app (pick a unique name; update fly.toml's `app =` to match)
flyctl apps create reconcile-app     # or let it suggest a name

# Managed Postgres, attached — sets DATABASE_URL secret automatically
flyctl postgres create --name reconcile-db --region ord
flyctl postgres attach reconcile-db --app reconcile-app
```

## 3. Set secrets (never in the image)

```bash
# from reconcile/.env — Shopify keys come from the linked app,
# QBO keys are your Intuit sandbox creds
flyctl secrets set \
  SHOPIFY_API_KEY=87ae058b65951a8f47aa152331b13983 \
  SHOPIFY_API_SECRET=<from `npm run shopify app env show` or Partner dashboard> \
  QBO_CLIENT_ID=<from .env> \
  QBO_CLIENT_SECRET=<from .env> \
  JOBS_TOKEN=<any long random string> \
  --app reconcile-app
```

`DATABASE_URL` is set by the postgres attach. `SHOPIFY_APP_URL`, `QBO_REDIRECT_URI`,
and `QBO_ENV` are set in step 5 once we know the domain.

## 4. Deploy

```bash
flyctl deploy --app reconcile-app
```

This builds the image, runs `prisma migrate deploy` (applies the init migration),
and starts `remix-serve`. Note the app URL, e.g. `https://reconcile-app.fly.dev`.

## 5. Point everything at the Fly domain

```bash
flyctl secrets set \
  SHOPIFY_APP_URL=https://reconcile-app.fly.dev \
  QBO_REDIRECT_URI=https://reconcile-app.fly.dev/qbo/callback \
  QBO_ENV=sandbox \
  --app reconcile-app
```

Then update Shopify app URLs (from the app dir, one-time):
- In `shopify.app.toml`: set `application_url` and the `[auth]` redirect to the Fly
  domain, then `npm run deploy` (uploads config to Shopify), OR set them in the
  Partner dashboard → App setup → URLs:
  - App URL: `https://reconcile-app.fly.dev`
  - Allowed redirect URLs: `https://reconcile-app.fly.dev/auth/callback`,
    `https://reconcile-app.fly.dev/auth/shopify/callback`

And register the QBO redirect in Intuit → your app → Keys & Credentials → Redirect URIs:
- `https://reconcile-app.fly.dev/qbo/callback`

## 6. Cron for the payout sweep

Fly Machines can run a scheduled task, or use any external cron to POST hourly:
```
curl -X POST https://reconcile-app.fly.dev/jobs/sweep -H "x-jobs-token: <JOBS_TOKEN>"
```

## 7. End-to-end test

Install the app on `jonahxa.myshopify.com`, approve the (test-mode) subscription,
click Connect QuickBooks → real OAuth → map accounts → add a test order in the store
→ Sync now → confirm the payout posts to the QBO sandbox.
