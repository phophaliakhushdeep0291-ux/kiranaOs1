# Local release verification — 22 September 2026

This folder is local synthetic QA evidence, not deployment certification. The source is an uncommitted working tree based on the commit in `verification-summary.json`. No real payment, production data, publish or external message was used.

- `verification-summary.json` records exact counts, stages, skips, limits and original local log hashes. `test-results.txt` is the concise result extract.
- `source-fingerprint.json` identifies every changed/new implementation file against that base. `rental-source-fingerprint.json` retains the earlier verified rental checkpoint before furniture work.
- `rental-reconciliation.json`, closing captures and statement captures prove the dated rental money flow, including incomplete-report protection and reconnection.
- `furniture-reconciliation.json`, installed-page capture and invalid-bill capture prove one same-day cash order through invoice, delivery and installation. The image is a visual check of the final page; this is not a full device-width matrix.
- `furniture-open-gap.json` is the earlier finding. Its stock of 20 was observed **before** the new test sale reduced the shared product to 19. The older order is still unlinked and requires reconciliation; the safeguard does not repair it.
- `manufacturing-prior-session.json` is explicitly prior-session browser evidence. The latest full integration run includes manufacturing, but no new complete manufacturing browser walkthrough is claimed.
- `migration-smoke.json` records the disposable SQLite upgrade check. PostgreSQL schema validation is not proof of a PostgreSQL upgrade.
- `manifest.json` checksums the evidence. Local source recovery archives are recorded in `verification-summary.json` after finalization and exclude databases, environment files and credentials.

The release remains NO-GO. See `../../DEPLOYMENT_READINESS_2026-09-22.md` and the repository release gate for remaining accounting, legacy-data, production and physical-device requirements.
