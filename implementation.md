# Implementation Plan

## Phase 1: Project Setup
1. Initialize repository structure for Worker and Pages.
2. Create `wrangler.toml` with D1 bindings and Pages config.
3. Add a `README` with local and deploy steps and token usage.

## Phase 2: Database Schema
1. Write `schema.sql` to create tables and indexes.
2. Add triggers to prevent `UPDATE` or `DELETE` on `ledger_events`.
3. Add constraints for unique student token and unique registration per lesson.

## Phase 3: Worker API
1. Implement request routing and JSON responses.
2. Implement student auth via `?t=TOKEN` and admin auth via header or query token.
3. Implement utility functions:
   - `now()` and time parsing.
   - `loadStudentByToken` and `requireAdmin`.
   - `expireLotsIfNeeded` and `getAvailableCredits`.
   - `consumeCreditFIFO` and `restoreCreditToLot`.
4. Implement public endpoints:
   - `GET /status` (with optional ledger, `ledger=all` for full history).
   - `POST /register` (idempotent, transactional).
   - `POST /cancel` (idempotent, transactional).
5. Implement admin endpoints:
   - `POST /admin/addStudent`.
   - `POST /admin/addPurchase`.
   - `POST /admin/setNextLesson`.
   - `GET /admin/list`.
   - `POST /admin/clearRegistrations`.
   - `POST /admin/extendValidity`.
6. Add CORS support for Pages.

## Phase 4: Frontend (Pages)
1. Build `index.html` with a simple layout for student and admin views.
2. Add `styles.css` with minimal but clear styling.
3. Add `app.js` to:
   - Parse token from URL.
   - Fetch status and update the UI.
   - Register/cancel with buttons.
   - Render ledger (optional toggle).
4. Add admin UI handlers for managing students, purchases, and lessons.

## Phase 5: PWA Support
1. Create `manifest.json`.
2. Create `service-worker.js` with a minimal cache-first strategy.
3. Register the service worker in `app.js`.

## Phase 6: Validation and Testing
1. Validate schema and triggers locally via D1.
2. Test all endpoints via curl or simple scripts.
3. Verify registration/cancel time window enforcement.
4. Confirm FIFO consumption and expiry logic by creating multiple lots.

## Phase 7: Deployment
1. Deploy Worker and Pages with Wrangler.
2. Apply D1 migrations in production.
3. Share admin token and student links securely.
