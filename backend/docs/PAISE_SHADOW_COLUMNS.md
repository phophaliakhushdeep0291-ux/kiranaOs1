# Paise Shadow Columns Runbook

Phase 27 adds nullable integer paise columns next to existing rupee Float fields. This reduces migration risk because the current app can keep reading/writing old fields while production data is audited and backfilled.

## Why this exists

Float money storage is risky for billing, udhar, GST, reports, and profit/loss because binary floating-point numbers can drift. Integer paise columns make financial comparisons deterministic.

## What changed

PostgreSQL migration:

```text
prisma-postgres/migrations/000009_money_paise_shadow_columns/migration.sql
```

Reconciliation script:

```text
scripts/money-paise-reconciliation.js
```

Commands:

```bash
npm run money:paise:reconcile
ALLOW_MONEY_PAISE_BACKFILL=true npm run money:paise:backfill
```

## Safe rollout order

1. Take a PostgreSQL backup.
2. Deploy migration `000009_money_paise_shadow_columns`.
3. Run `npm run money:paise:reconcile`.
4. If mismatches/missing values appear, verify backup, then run `npm run money:paise:backfill`.
5. Run `npm run proof:postgres`.
6. Only after this, update runtime services to write both Float and paise values for new records.
7. Later, switch reads/reports to paise-first.
8. Much later, remove or freeze old Float columns.

## What this phase does not do yet

This phase does not make the whole app paise-first. It prepares production data and migrations so the final money migration can happen safely without a risky big-bang rewrite.
