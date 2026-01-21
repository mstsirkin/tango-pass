# Ledger Backups (R2)

## Overview
- Weekly snapshots of the full `ledger_events` table are written to R2.
- Snapshots are append-only: each export is stored under a unique timestamped key.

## Storage
- Bucket: `tango-pass-ledger-backups-test` (testing)
- Bucket: `tango-pass-ledger-backups-prod` (production)
- Key format: `ledger/YYYY/MM/DD/ledger-YYYY-MM-DDTHH-MM-SS.sssZ.json`

## Export Triggers
- Scheduled weekly export via Worker cron.
- On-demand export via `POST /admin/exportLedger` (admin token required).

## Capacity and Failures
- If the bucket fills up or R2 is disabled, exports will fail and return an error.
- Mitigation: delete old snapshots or apply a lifecycle policy in R2.

## Payload
Each snapshot is a JSON object:
- `generated_at`
- `count`
- `rows` (array of `ledger_events` rows)

## Restore
- Download the desired snapshot from R2.
- Import into a new D1 database or use it for audit/reporting.
