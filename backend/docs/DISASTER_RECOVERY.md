# Disaster Recovery and Backup/Restore Proof

Phase 28 adds a real disaster-recovery drill for PostgreSQL. A SaaS backend is not production-ready until backups are not only created, but also restored into a safe test database and verified.

## What this proves

The proof checks that:

1. `pg_dump` can create a non-empty logical backup.
2. The restore target is not the production database.
3. The restore target database name looks safe, such as `kiranaos_restore_test`, `kiranaos_test`, `kiranaos_ci`, or `kiranaos_staging`.
4. The restore-test database can be reset and restored.
5. Restored database tables exist.
6. Money paise shadow reconciliation still passes after restore.

## Create a backup

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

This command will reset only the restore-test database schema, restore the backup, verify tables, and run money paise reconciliation against the restored database.

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
- `RESTORE_TEST_DATABASE_URL` is different from `DATABASE_URL`.
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
