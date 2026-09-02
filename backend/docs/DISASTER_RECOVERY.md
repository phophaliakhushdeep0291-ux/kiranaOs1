# Disaster Recovery and Backup/Restore Proof

Phase 28 adds a real disaster-recovery drill for PostgreSQL. A SaaS backend is not production-ready until backups are not only created, but also restored into a safe test database and verified.

## What this proves

The proof checks that:

1. `pg_dump` can create a non-empty logical backup.
2. The restore target is not the production database.
3. The restore target database name looks safe, such as `kiranaos_restore_test`, `kiranaos_test`, `kiranaos_ci`, or `kiranaos_staging`.
4. The restore-test database can be reset and restored.
5. Every public table matches the source by exact row count and sorted SHA-256 row-content digest, including the migration ledger.
6. The source contains real records in Shop, Product, Customer, Bill, BillItem, Payment and UdharLedger; an empty financial schema cannot pass.
7. Money paise shadow reconciliation passes in read-only mode after restore. This does not depend on a developer's currently generated Prisma client.

Fresh dumps and source manifests use the same exported PostgreSQL transaction
snapshot. Concurrent source writes therefore do not produce false comparisons.
Source data is never seeded by `proof:dr`; the separate `test:restore-runtime`
command adds two synthetic tenants only to a safety-validated test database.

## Create a backup

There are two separate backup layers:

- Platform database backups use `pg_dump` and are the authoritative
  whole-service disaster-recovery source.
- Owner-requested shop backups are encrypted, tenant-scoped logical artifacts
  available through `/api/jobs/backups`. They support portable shop-data
  recovery and audit, but do not contain passwords, PIN hashes, sessions, API
  keys, or webhook secrets.

Shop artifacts use the `KOSB1` envelope: gzip-compressed JSON encrypted with
AES-256-GCM and recorded with a SHA-256 checksum. Production requires
`BACKUP_ENCRYPTION_KEY`, Redis workers, and S3/R2/MinIO storage. Rotating the
encryption key requires retaining the old key until all artifacts encrypted
with it have expired or been re-encrypted.

The worker process registers an idempotent BullMQ schedule for bounded expired
artifact cleanup. `BACKUP_CLEANUP_INTERVAL_HOURS` defaults to 24; operators
must monitor the backup queue and worker heartbeat so retention is enforced.

```bash
DATABASE_URL="postgresql://kiranaos:***@localhost:5432/kiranaos" \
BACKUP_DIR="./backups" \
npm run backup:postgres
```

By default this creates a custom-format `.dump` file using:

```text
pg_dump --format=custom --no-owner --no-privileges
```

You can also use the shell script:

```bash
DATABASE_URL="postgresql://..." BACKUP_DIR="./backups" ./scripts/backup-postgres.sh
```

## Run a restore drill

Create a separate restore-test database first, for example:

```bash
createdb kiranaos_restore_test
```

Then run:

```bash
DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos?schema=public" \
RESTORE_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_restore_test?schema=public" \
ALLOW_RESTORE_TEST_DB=true \
BACKUP_DIR="./backups" \
npm run proof:dr
```

This command resets only the restore-test database's public schema, restores the
backup, compares content and counts, and checks money without repairing it. It
emits a timestamped JSON report and `disaster-recovery-proof-latest.json` under
`backend/release-artifacts`. Reports contain hashes/counts, not customer rows.
Keep reports private: even hashes of low-entropy data are not anonymization.

Set `PG_BIN_DIR` when native PostgreSQL tools are not on PATH. Prisma-only URL
parameters such as `schema` are removed for native tools; SSL settings are kept.
Native recovery verification currently supports the public application schema.

The drill removes only its own freshly generated dump unless `DR_KEEP_BACKUP=true`.
It never deletes a supplied `BACKUP_FILE`. To rehearse an existing dump, set
`DR_CREATE_BACKUP=false`, `BACKUP_FILE`, and `BACKUP_MANIFEST_FILE` to its trusted
same-snapshot report. The dump checksum is checked before resetting the target.
Keep that manifest in trusted storage; this is not a digital-signature scheme.

For repeatable regression coverage use `npm run test:restore-runtime` with
`POSTGRES_TEST_DATABASE_URL`, `ALLOW_POSTGRES_TEST_DB=true` and a distinct restore
target. It verifies populated multi-tenant records, concurrent source writes,
same-count one-paise tampering, checksum rejection before reset, and a fresh
restore. CI runs this test against its disposable PostgreSQL databases.

## Strict production proof mode

When you are doing final pre-sell validation, include disaster recovery in the full proof suite:

```bash
PROOF_BASE_URL=http://localhost:3000 \
POSTGRES_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_test?schema=public" \
DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos?schema=public" \
RESTORE_TEST_DATABASE_URL="postgresql://kiranaos:kiranaos@localhost:5432/kiranaos_restore_test?schema=public" \
ALLOW_RESTORE_TEST_DB=true \
QUEUES_ENABLED=true \
REDIS_URL=redis://localhost:6379 \
PROOF_REQUIRE_LIVE=true \
PROOF_REQUIRE_POSTGRES=true \
PROOF_REQUIRE_WORKER=true \
PROOF_REQUIRE_DR=true \
npm run proof:ops
```

## Safety rules

The restore proof refuses to run unless:

- `ALLOW_RESTORE_TEST_DB=true` is set.
- The restore database name differs from the source even when hostnames differ, preventing localhost/DNS alias bypasses.
- Neither URL overrides connection identity through query parameters such as `dbname`, `hostaddr`, or `service`.
- The restore database name contains a safe marker like `test`, `_ci`, `restore`, `drill`, or `staging`.
- The restore database name does not contain production-looking words like `prod`, `production`, `live`, `primary`, or `main`.

## Production backup policy

Minimum production policy:

- Automated daily logical backup.
- Encrypted backup storage.
- At least 30 days retention.
- Weekly restore drill during beta.
- Monthly restore drill after stable launch.
- Backup alert if no fresh backup exists.
- Restore drill record before onboarding real paid shops.

## What not to do

Do not restore into your production database to “test backup”. Always restore into a separate throwaway database.

Do not treat backup creation alone as proof. A backup that cannot be restored is not a backup.

This local proof does not certify cloud durability, cross-region recovery,
production-scale RTO/RPO or incident response. It compares public-table content,
not sequence state, roles, permissions, indexes or non-public schemas. Hash
aggregation is bounded by a query timeout and fails closed on resource limits;
large production databases still need a measured restore rehearsal.
