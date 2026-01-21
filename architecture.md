# Tango Pass Architecture

## Overview
This system sells and manages tango lesson passes. Students use a secret token link to view status and register or cancel for the next lesson. A teacher/admin uses a separate admin token to manage students, purchases, lessons, and registrations. There are no logins, cookies, or sessions. All data is stored in Cloudflare D1 (SQLite) and accessed through a Cloudflare Worker. The frontend is a static HTML/CSS/JS PWA hosted on Cloudflare Pages.

## Components
- Cloudflare Pages: static frontend (student and teacher views).
- Cloudflare Worker: JSON API backend, responsible for enforcing all business rules and writing ledger history.
- Cloudflare D1 (SQLite): persistent data storage with triggers to protect the ledger.

## Authentication Model
- Student access: query parameter token on all student endpoints, e.g. `?t=TOKEN`.
- Admin access: admin token provided to admin endpoints (e.g. header `X-Admin-Token` or query param `adminToken`).
- No sessions, no cookies, no server-side login state.

## Data Model (D1 / SQLite)
Tables:
- `students`: `id`, `token`, `name`, `created_at`.
- `lots`: `id`, `student_id`, `purchased_at`, `validity_months`, `expires_at`, `credits_total`, `credits_remaining`.
- `lesson_events`: `id`, `starts_at`.
- `registrations`: `id`, `student_id`, `lesson_id`, `consumed_lot_id`, `registered_at`.
- `ledger_events`: `id`, `student_id`, `ts`, `type`, `delta_credits`, `balance_after`, `ref_lot_id`, `ref_lesson_id`.

Ledger constraints:
- `ledger_events` is append-only.
- SQLite triggers forbid `UPDATE` and `DELETE` on `ledger_events`.
- Type `OLDEST` marks a specific event boundary. All lots before this event are considered expired for balance calculations.

## Business Rules
- Passes are sold in lots (bundle purchases) with 1-month or 3-month validity.
- Credits are consumed FIFO from the oldest unexpired lot first.
- Expired credits are not usable.
- Students can register or cancel up to 2 hours before the lesson; no changes after.
- Admin can add students, add purchases, set next lesson, view registrations, cancel registrations, clear registrations after lesson, and extend validity for still-valid lots by a fixed amount.
- Financial and usage history is preserved via ledger events.

## Backend API (Worker)
All endpoints are JSON-only and require CORS enabled for Pages.

Public (student):
- `GET /status?t=TOKEN`
  - Returns student name, total available credits (non-expired), next lesson datetime, registration status.
- `GET /status?t=TOKEN&ledger`
  - Returns ledger history for the student, defaulting to the most recent `OLDEST` cutoff.
- `GET /status?t=TOKEN&ledger=all`
  - Returns full ledger history including entries before the cutoff.
- `POST /register?t=TOKEN`
  - Idempotent.
  - Uses a transaction to: expire lots if needed, enforce uniqueness, consume 1 credit FIFO, append ledger event, create registration.
- `POST /cancel?t=TOKEN`
  - Idempotent.
  - Uses a transaction to: enforce cancellation window, remove registration, re-credit FIFO to consumed lot, append ledger event.

Admin (requires admin token):
- `POST /admin/addStudent`
  - Adds student with generated token.
- `POST /admin/addPurchase`
  - Creates a new lot and ledger event.
- `POST /admin/setNextLesson`
  - Creates or updates the next `lesson_events` row.
- `POST /admin/clearRegistrations`
  - Clears registrations for a lesson after it is complete; ledger preserves usage history.
- `GET /admin/list`
  - Lists students, lots, and current registrations.
- `POST /admin/extendValidity`
  - Extends `expires_at` for all still-valid lots and appends ledger `EXTEND` events.

## Expiry and FIFO Enforcement
- Expiry is enforced lazily on reads and writes.
- Whenever a student registers, cancels, or status is requested, the Worker checks for expired lots and applies ledger `EXPIRE` events and `OLDEST` markers as needed.
- FIFO consumption chooses the earliest `lot` with `credits_remaining > 0` and `expires_at > now`.

## Transactions and Concurrency
- All registration and purchase operations occur in SQL transactions.
- Registration is idempotent by enforcing `UNIQUE(student_id, lesson_id)`.
- Ledger updates and lot consumption are written atomically in the same transaction.

## Frontend (Pages)
Student view:
- Single screen showing credits available, next lesson time, registration open/closed status, and registration status.
- Buttons for registering and canceling.
- Optional .ics generation for calendar.

Teacher view:
- Simple admin screen to add students, add purchases, view registrations, clear registrations, and share student links.

## PWA
- `manifest.json` and `service-worker.js` for installability.
- Minimal offline cache of static assets.

## Security and Validation
- All input validated server-side.
- Tokens are treated as secrets; only sent over HTTPS.
- No client-supplied credit or balance data is trusted.
- Ledger is append-only and immutable.

## Deployment
- Local development via Wrangler with Pages and Worker.
- D1 migrations applied via Wrangler.
- Same code paths used locally and in production.
