# Testing Plan

## Goals
- Validate correctness of FIFO credit usage, expiry handling, and cancellation rules.
- Ensure all API endpoints behave deterministically and are idempotent where required.
- Confirm D1 schema invariants (ledger append-only) and uniqueness constraints.
- Verify that frontend flows call the correct endpoints and render state consistently.

## Scope
- Database schema and triggers.
- Worker API endpoints (student and admin).
- PWA static assets and service worker registration.

## Local Environment
- Wrangler for Worker + Pages.
- D1 local database with migrations applied.
- Use curl or a simple script to hit endpoints.

## Database Tests (Manual/Scripted)
- Apply schema migration and confirm tables/indices exist.
- Attempt `UPDATE` and `DELETE` on `ledger_events` and expect trigger failures.
- Insert sample students, lots, and lessons and verify FK relationships.

## API Tests (Manual/Scripted)

### Student endpoints
1. `GET /status?t=TOKEN`
   - New student with no lots: credits = 0, not registered.
2. `POST /register?t=TOKEN`
   - Without credits: expect error.
3. Add purchase and retry register:
   - First register succeeds, creates `registrations` row, decrements correct lot.
4. Repeat `POST /register`:
   - Must be idempotent and not double-charge.
5. `POST /cancel?t=TOKEN` before cutoff:
   - Restores credit to the same lot referenced in registration.
6. `POST /cancel` after cutoff:
   - Must be rejected.
7. `GET /status?t=TOKEN&ledger=all`:
   - Full history includes entries before any `OLDEST` cutoff.

### FIFO and expiry
1. Add multiple lots with different purchase times and expiry dates.
2. Register multiple lessons:
   - Credits consumed from oldest unexpired lot first.
3. Simulate time past expiry:
   - `GET /status` or `POST /register` should append `EXPIRE` and adjust balances.

### Admin endpoints
1. `POST /admin/addStudent`:
   - Token generated, student appears in `/admin/list`.
2. `POST /admin/addPurchase`:
   - Creates lot and ledger `PURCHASE` event.
3. `POST /admin/setNextLesson`:
   - Lesson visible in student `GET /status`.
4. `GET /admin/list`:
   - Lists students, lots, and registrations.
5. `POST /admin/clearRegistrations`:
   - Clears registration rows for the lesson; ledger preserved.
6. `POST /admin/extendValidity`:
   - Extends expires_at for valid lots; appends ledger `EXTEND` events.
7. `POST /admin/exportLedger`:
   - Writes a snapshot to R2; response includes key and count.

## Frontend Tests
- Load `index.html` with a valid student token:
  - Status loads, register/cancel buttons reflect current state.
- Load admin view:
  - Can add student and purchase, and list updates as expected.
- Verify PWA installability:
  - `manifest.json` loads with correct icons.
  - Service worker registers successfully in browser.

## Regression Checklist
- Registration idempotency: no double ledger entries.
- Cancellation credits the exact lot used.
- Cutoff window enforced (2 hours before lesson).
- Ledger is append-only and audit trail is preserved.

## Optional Automation (Future)
## Scripted Smoke Test
- Use `scripts/smoke-test.sh` with `API_BASE` and `ADMIN_TOKEN`.
- Example: `API_BASE=https://tango-pass-test.cloud-8af.workers.dev ADMIN_TOKEN=... ./scripts/smoke-test.sh`.
