# KiranaOS Release Certification

- Status: **failed**
- Mode: **ci**
- Commit: `23e5452f315e2f7304e2ffe7f2a8bc7e22c188c6`
- Branch: `main`
- Working tree dirty: **no**
- Started: 2026-07-13T16:13:49.796Z
- Completed: 2026-07-13T16:18:40.316Z

| Check | Required | Status | Duration | Detail |
| --- | --- | --- | ---: | --- |
| Release approval and rollback metadata | no | skipped | 0s | set RELEASE_VERSION, RELEASE_APPROVER, RELEASE_APPROVED=true, and RELEASE_ROLLBACK_IMAGE |
| Validate SQLite Prisma schema | yes | passed | 0.8s |  |
| Validate PostgreSQL Prisma schema | yes | passed | 0.8s |  |
| Migration safety and sequence | yes | passed | 0.2s |  |
| Release documentation and rollback gate | yes | passed | 0.1s |  |
| Backend source and calculation tests | yes | failed | 1.8s | node:internal/modules/run_main:123     triggerUncaughtException(     ^  AssertionError [ERR_ASSERTION]: purchase/correction must fail safely on concurrent stock writes     at file:///home/runner/work/kiranaOs1/kiranaOs1/backend/tests/phase19-production-correctness.examples.js:20:1     at ModuleJob.run (node:internal/modules/esm/module_job:343:25)     at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)     at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {   generatedMessage: false,   code: 'ERR_ASSERTION',   actual: false,   expected: true,   operator: '==',   diff: 'simple' }  Node.js v22.23.1 |
| Backend regression and integration tests (isolated SQLite) | yes | passed | 88s |  |
| Backend production readiness checks | yes | passed | 0.2s |  |
| Static API contract proof | yes | passed | 0.1s |  |
| Razorpay signature fixture proof | yes | passed | 0.2s |  |
| Frontend typecheck, tests, build, and security checks | yes | passed | 64.4s |  |
| Local object storage read/write/delete proof | yes | passed | 0.2s |  |
| PostgreSQL migrations, regression, integration, concurrency, and reconciliation | yes | failed | 104.9s | ❌ Failed: Run DB-backed integration and concurrency tests |
| Redis queue and worker execution proof | yes | passed | 0.5s |  |
| Deployed worker heartbeat freshness | no | skipped | 0s | start the production worker and set PROOF_REQUIRE_WORKER=true with Redis configured |
| Live API contract smoke | no | skipped | 0s | set PROOF_BASE_URL or CONTRACT_SMOKE_BASE_URL |
| Live backend workflow smoke | no | skipped | 0s | set PROOF_BASE_URL or SMOKE_BASE_URL |
| Production object storage signed URL and cleanup proof | no | skipped | 0s | configure a non-local STORAGE_PROVIDER and its bucket credentials |
| PostgreSQL backup and isolated restore drill | no | skipped | 0s | set RESTORE_TEST_DATABASE_URL and ALLOW_RESTORE_TEST_DB=true |
| Production Docker image build | yes | passed | 28.1s |  |

Strict certification succeeds only when live API, PostgreSQL, Redis worker, cloud object storage, Docker, disaster recovery, approval, and rollback evidence all pass.
