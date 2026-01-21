# Database Schema and Rules

## Tables
- `students`: student identity and secret token.
- `lots`: purchased lesson bundles with validity and remaining credits.
- `lesson_events`: scheduled lessons (only the next one is used by the UI).
- `registrations`: per-lesson registrations, with `consumed_lot_id` referencing the lot used.
- `ledger_events`: append-only audit trail of all credit changes.

## Key Constraints
- `students.token` is unique.
- `registrations` enforces `UNIQUE(student_id, lesson_id)` for idempotent register.
- `ledger_events` is append-only via triggers that forbid `UPDATE`/`DELETE`.
- `lots.validity_months` is restricted to 1 or 3.

## FIFO Consumption
- Registration consumes credits from the oldest unexpired lot with `credits_remaining > 0`.
- The chosen lot id is recorded in `registrations.consumed_lot_id` to allow deterministic refunds.

## Expiry
- Expiry is enforced lazily: on `GET /status`, `POST /register`, and admin actions.
- Expired lots have `credits_remaining` reduced to 0 and an `EXPIRE` ledger event is appended.

## Ledger Events
Types:
- `PURCHASE`: +credits for a new lot.
- `REGISTER`: -1 credit for a registration.
- `EXPIRE`: -remaining credits when a lot expires.
- `ADJUST`: manual adjustments, including cancellations (refunds).
- `EXTEND`: validity extension (no credit delta unless explicitly changed).
- `OLDEST`: zero-delta marker used as a cutoff for ledger history.

`balance_after` is stored on every ledger row and updated atomically in transactions.

## OLDEST Cutoff
- `OLDEST` is an optimization marker; all events before it are considered irrelevant to the current balance.
- The ledger API defaults to returning events from the most recent `OLDEST` marker onward.
- Clients can request full history by using `GET /status?t=TOKEN&ledger=all`.

## Referential Integrity
- Foreign keys link lots/registrations/ledger to students and lessons.
- All history is preserved in `ledger_events`; clearing registrations does not delete ledger rows.
