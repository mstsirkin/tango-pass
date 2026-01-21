# Deployment Plan

## Environments
- Testing: full replica with its own Worker, D1 database, and Pages project/URL.
- Production: same code, separate Worker, D1 database, and Pages project/URL.
- Deployment flow: deploy to testing first; if verified, deploy the same code to production.

## Prerequisites
- Wrangler authenticated (`wrangler whoami`).
- Cloudflare account with Pages and D1 access.

## D1 Setup
### Testing
1. Create a D1 database:
   - `wrangler d1 create tango-pass-test`
2. Add the D1 binding for testing in `wrangler.toml`.
3. Apply migrations:
   - `wrangler d1 migrations apply tango-pass-test --local`
   - `wrangler d1 migrations apply tango-pass-test --remote`

## R2 Setup (Ledger Backups)
### Testing
1. Enable R2 in the Cloudflare dashboard (one-time per account).
1. Create an R2 bucket:
   - `wrangler r2 bucket create tango-pass-ledger-backups-test`
2. Ensure the `LEDGER_BACKUPS` binding is set in `wrangler.toml`.

### Production
1. Enable R2 in the Cloudflare dashboard (one-time per account).
1. Create an R2 bucket:
   - `wrangler r2 bucket create tango-pass-ledger-backups-prod`
2. Ensure the `LEDGER_BACKUPS` binding is set in `wrangler.toml`.

### Production
1. Create a D1 database:
   - `wrangler d1 create tango-pass-prod`
2. Add the D1 binding for production in `wrangler.toml`.
3. Apply migrations:
   - `wrangler d1 migrations apply tango-pass-prod --remote`

## Worker Deployment
### Testing
1. Configure `wrangler.toml` with a testing environment:
   - Worker name
   - D1 binding
   - Admin token via environment variable
2. Deploy Worker:
   - `wrangler deploy --env testing`

### Production
1. Configure `wrangler.toml` with a production environment:
   - Worker name
   - D1 binding
   - Admin token via environment variable
2. Deploy Worker:
   - `wrangler deploy --env production`

## Pages Deployment
### Testing
1. Create a Pages project for testing.
2. Deploy static assets to the testing project.
3. Ensure frontend API base URL points to the testing Worker URL.
4. Testing URL: `https://solotango-test.pages.dev`.

### Production
1. Create a Pages project for production.
2. Deploy static assets to the production project.
3. Ensure frontend API base URL points to the production Worker URL.

## Scripted Testing Deploy
- Use `deploy-test.sh` to deploy Worker + Pages to testing.
- Set `ADMIN_TOKEN` in the environment before running the script.
- If the Worker URL cannot be detected, set `TEST_WORKER_URL`.

## Tokens
- Admin token stored as a Worker environment variable per environment.
- Student token generated at `/admin/addStudent` and shared via link `?t=TOKEN`.

## Validation After Deploy
- `GET /status?t=TOKEN` returns expected data.
- `POST /register?t=TOKEN` works and updates credits.
- Admin can add purchase and set next lesson.
- PWA installs from Pages domain.

## Promotion Flow
1. Deploy to testing.
2. Run the checks in `testing.md` against the testing URL.
3. If happy, deploy the same commit to production.
