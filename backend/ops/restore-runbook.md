# Restore runbook — bringing a shop's data back

**Read this whole page before typing anything.** A restore replaces a shop's business
data. It is atomic and it takes a recovery backup first, so it is recoverable — but it
also signs every till in the shop out, and a shopkeeper who is not told that will think
the app has broken during trade.

Scope: one shop's logical data (products, bills, bill items, payments, udhar ledger, stock
ledger, inventory lots, suppliers, purchases, customers, audit log — 77 tables in all).
This is not the Postgres-level disaster recovery path; for a lost *database* rather than a
lost *shop's data*, see `scripts/disaster-recovery-proof.js`.

---

## 0. Before you start

| Check | How |
|---|---|
| You have the owner's PIN | The owner must give it to you. Every route below is PIN-gated. |
| You know which shop | You need its `shopId`. Restoring the wrong tenant is refused, but check anyway. |
| `BACKUP_ENCRYPTION_KEY` is the same key the backup was written with | A rotated key makes every older artifact undecryptable. |
| Nobody is mid-sale | The shop is locked for the duration and tills are signed out afterwards. |

Artifacts expire after `BACKUP_RETENTION_DAYS` (default 30). An expired artifact's object
is deleted; its metadata row survives, so a listing showing the backup does **not** prove
the data is still there. Check `expires_at`.

---

## 1. Find the artifact

```bash
curl -s -H "authorization: Bearer $TOKEN" -H "x-owner-pin: $PIN" \
  "$API/api/jobs/backups?limit=25"
```

Expect a list, newest first. You want one with `"status": "completed"`, a non-null
`checksum_sha256`, and an `expires_at` in the future. Note its `id`.

## 2. Dry-run it first — this changes nothing

```bash
curl -s -X POST -H "authorization: Bearer $TOKEN" -H "x-owner-pin: $PIN" \
  "$API/api/jobs/backups/<ARTIFACT_ID>/restore-preview"
```

This verifies the checksum, decrypts, and validates tenant, schema version and table
completeness **without writing**. Expect per-table record counts. If this fails, stop —
the restore would fail the same way, and the failure codes tell you which:

| Code | Meaning | What to do |
|---|---|---|
| `BACKUP_CHECKSUM_MISMATCH` | Stored bytes no longer match the recorded hash | Artifact is damaged. Use an older one. |
| `BACKUP_DECRYPTION_FAILED` | Wrong key, or tampered envelope | Check `BACKUP_ENCRYPTION_KEY`. |
| `BACKUP_SCHEMA_INCOMPATIBLE` | Written by a different schema version | Needs an engineer; do not force it. |
| `BACKUP_TENANT_MISMATCH` | Artifact belongs to another shop | You have the wrong id. |
| `BACKUP_TABLES_INCOMPLETE` | Snapshot is missing tables | Use an older artifact; raise a bug. |

## 3. Tell the shopkeeper, then restore

Say this before you run it, not after:

> "I'm putting your data back from the backup of *<date/time of the artifact>*. It takes
> about a minute. While it runs, billing will not work. Afterwards every phone and
> counter machine will ask you to sign in once — that is normal, it is how each device
> picks up the restored data. Anything billed **after** *<that date/time>* will not be
> there, and we will need to re-enter it."

That last sentence is the one that matters. A restore is a point-in-time rewind; sales
made after the backup are gone.

```bash
curl -s -X POST -H "authorization: Bearer $TOKEN" -H "x-owner-pin: $PIN" \
  -H "content-type: application/json" \
  -d '{"confirmation":"RESTORE <LAST 6 CHARS OF ARTIFACT ID>"}' \
  "$API/api/jobs/backups/<ARTIFACT_ID>/restore"
```

The confirmation string is literally `RESTORE ` followed by the last six characters of the
artifact id. It exists so this cannot be run by pasting a command without reading it.

**Expected response:** `restoredRecords`, `restoredTables` (77), `artifact_id`, and a
`recovery_backup` object — that last one is the shop as it was *immediately before* this
restore. Write its id down. It is your undo.

## 4. How long it takes

Declared tenant-logical target for a small shop (up to roughly 2,000 records): **RTO <=
60 seconds**. The 2026-08-08 local drill restored 1,781 records across 77 tables in
0.616 seconds; use the 60-second target, not that workstation result, for operations.
The transaction's 180-second timeout is an abort ceiling, not the target.

The corresponding production **RPO target is <=24 hours**, but this endpoint currently
creates owner-requested artifacts on demand. Meeting that RPO therefore depends on the
required automated daily platform/PostgreSQL backup policy. Until a managed-provider
backup and restore-test run is recorded, the RPO is a release-gate requirement rather
than a proven property.

| Shop size | Restore |
|---|---|
| A year of a small kirana (1,781 records, local SQLite drill) | 0.616 seconds observed; <=60 seconds target |
| Large shop, several years | Under a minute |

The transaction is allowed up to 15s to acquire and 180s to run before it aborts. If it
aborts, **nothing was written** — the whole restore is one serializable transaction. The
maintenance lock is released either way.

If a second restore is attempted while one is running you get `423
SHOP_MAINTENANCE_LOCKED`. Wait; do not retry in a loop.

## 5. Every device must sign in again

The restore increments the shop's `dataEpoch`. Any device still holding the old epoch is
refused with `409 DEVICE_REBOOTSTRAP_REQUIRED` — including on `POST /api/sync/push`.

**This is deliberate and it is the safety property.** A till that was offline with unsent
bills cannot push them into the restored shop, because doing so would re-create records
the restore has just rebuilt and duplicate a day of trade. The device must sign in, pull
the verified cloud state, and start from there.

Tell the shopkeeper: *"Sign in on each machine. If it says anything about restoring, say
yes."*

Unsent local work on those devices is **not** merged automatically. If a till has bills
from after the backup point, capture them before signing it out — a screenshot of the
bill list is enough to re-enter them.

## 6. Verify before you walk away

Ask the owner to check three numbers against what they remember:

1. Today's (or the backup day's) total sales.
2. Two or three customers' udhar balances.
3. Stock on one fast-moving item.

Then confirm the restore is in the audit trail:

```bash
curl -s -H "authorization: Bearer $TOKEN" \
  "$API/api/audit-logs?action=SHOP_BACKUP_RESTORED&limit=5"
```

Exactly one new row for this artifact, with the operator's user id and device. Earlier
backup/restore control rows must still be present after a rollback.

## 7. If it went wrong

Restore the `recovery_backup` id from step 3 — same procedure, from step 2. That returns
the shop to the state it was in before you started.

If the restore itself failed, the shop was never modified; investigate with the error code
from the table in step 2 before trying a different artifact.

**Escalate** — do not improvise — if you see any of:

- `BACKUP_SCHEMA_INCOMPATIBLE` or `BACKUP_TABLES_INCOMPLETE`
- the restore succeeded but the owner's numbers in step 6 are wrong
- devices still refusing after a fresh sign-in

Escalation path: on-call backend engineer → the repository owner. Include the `shopId`,
the artifact id, the `requestId` from the failing response, and the audit rows around the
attempt.

---

## Proving this still works

Do not trust this page; run the drill. It seeds a year of trade, backs it up, destroys
every restorable row, restores, and reconciles at exact integer paise and exact stock
units.

```bash
cd backend && npm run backup:drill
```

Expect `✔ BACKUP DRILL PASSED — 0 paise and 0 unit variance` and exit 0.

And prove the drill itself can fail, so a green result means something:

```bash
cd backend && npm run backup:drill:verify
```

That runs the drill clean, then with one paise added, then with one stock unit added, and
requires the last two to fail. See `RELEASE_GATE.md` (SYNC-005) for the recorded run.
