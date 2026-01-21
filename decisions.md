# Architectural Decisions

## Token-Only Auth
- Students authenticate exclusively via a secret `?t=TOKEN` link.
- Admin uses a separate token header, stored locally in the admin UI.
- No sessions, cookies, or login state.

## Ledger as Source of Truth
- All credit-affecting events are recorded in `ledger_events`.
- Ledger rows are immutable via SQLite triggers.
- Balance is derived from the ledger, not from frontend state.

## OLDEST Cutoff
- `OLDEST` markers allow the API to omit old history by default.
- `ledger=all` returns the full history for audit or debugging.

## Lazy Expiry
- Credits are expired at read/write time, not via cron.
- Expiry events are recorded in the ledger when detected.

## Deterministic Refunds
- Registrations record `consumed_lot_id` so cancellations can refund the exact lot.

## Ledger Backups
- Weekly snapshots are written to R2 via a scheduled Worker cron.
- Admins can trigger on-demand exports with `/admin/exportLedger`.
