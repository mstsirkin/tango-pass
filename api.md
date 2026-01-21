# API Notes

## Authentication
- Student endpoints use query token: `?t=TOKEN`.
- Admin endpoints accept `X-Admin-Token-Encoded` header with `encodeURIComponent`-encoded token (preferred).
- `X-Admin-Token` and `adminToken` query param are still accepted for legacy/testing.

## Student Endpoints
- `GET /status?t=TOKEN`
  - Returns name, credits, next lesson, registration status.
- `GET /status?t=TOKEN&ledger`
  - Returns ledger entries from the most recent `OLDEST` marker.
- `GET /status?t=TOKEN&ledger=all`
  - Returns full ledger history.
- `POST /register?t=TOKEN`
  - Idempotent registration and FIFO debit.
- `POST /cancel?t=TOKEN`
  - Idempotent cancellation within the 2-hour window.

## Admin Endpoints
- `POST /admin/addStudent`
- `POST /admin/addPurchase`
- `POST /admin/setNextLesson`
- `POST /admin/clearRegistrations`
- `POST /admin/extendValidity`
- `POST /admin/cancelRegistration`
- `POST /admin/exportLedger`
- `GET /admin/backupStatus`
- `GET /admin/list`

## Error Handling
- JSON errors are returned as `{ "error": "code" }` with 4xx/5xx status.
- All endpoints are CORS-enabled for Cloudflare Pages.
