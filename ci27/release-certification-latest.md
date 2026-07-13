# KiranaOS Release Certification

- Status: **failed**
- Mode: **ci**
- Commit: `989854bea6f0e1b3ae651a11e4931e6e400cb4e0`
- Branch: `main`
- Working tree dirty: **no**
- Started: 2026-07-13T16:01:57.957Z
- Completed: 2026-07-13T16:06:51.566Z

| Check | Required | Status | Duration | Detail |
| --- | --- | --- | ---: | --- |
| Release approval and rollback metadata | no | skipped | 0s | set RELEASE_VERSION, RELEASE_APPROVER, RELEASE_APPROVED=true, and RELEASE_ROLLBACK_IMAGE |
| Validate SQLite Prisma schema | yes | passed | 0.9s |  |
| Validate PostgreSQL Prisma schema | yes | passed | 0.9s |  |
| Migration safety and sequence | yes | passed | 0.2s |  |
| Release documentation and rollback gate | yes | passed | 0.2s |  |
| Backend source and calculation tests | yes | failed | 1.8s | node:internal/modules/run_main:123     triggerUncaughtException(     ^  AssertionError [ERR_ASSERTION]: bill restore must also be concurrency-safe     at file:///home/runner/work/kiranaOs1/kiranaOs1/backend/tests/phase19-production-correctness.examples.js:16:1     at ModuleJob.run (node:internal/modules/esm/module_job:343:25)     at async onImport.tracePromise.__proto__ (node:internal/modules/esm/loader:681:26)     at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:117:5) {   generatedMessage: false,   code: 'ERR_ASSERTION',   actual: false,   expected: true,   operator: '==',   diff: 'simple' }  Node.js v22.23.1 |
| Backend regression and integration tests (isolated SQLite) | yes | failed | 96.4s | type: 'test'       ...     # Subtest: sync pull for Shop A does not return Shop B data     ok 4 - sync pull for Shop A does not return Shop B data       ---       duration_ms: 823.716333       type: 'test'       ...     # Subtest: reports for Shop A do not include Shop B data     ok 5 - reports for Shop A do not include Shop B data       ---       duration_ms: 913.89136       type: 'test'       ...     1..5 ok 15 - cross-shop tenant isolation   ---   duration_ms: 4426.61767   type: 'suite'   ... 1..15 # tests 130 # suites 13 # pass 127 # fail 2 # cancelled 0 # skipped 1 # todo 0 # duration_ms 91122.435528 |
| Backend production readiness checks | yes | passed | 0.2s |  |
| Static API contract proof | yes | passed | 0.1s |  |
| Razorpay signature fixture proof | yes | passed | 0.2s |  |
| Frontend typecheck, tests, build, and security checks | yes | passed | 59.9s |  |
| Local object storage read/write/delete proof | yes | passed | 0.2s |  |
| PostgreSQL migrations, regression, integration, concurrency, and reconciliation | yes | failed | 108.1s | ❌ Failed: Run DB-backed integration and concurrency tests |
| Redis queue and worker execution proof | yes | passed | 0.5s |  |
| Deployed worker heartbeat freshness | no | skipped | 0s | start the production worker and set PROOF_REQUIRE_WORKER=true with Redis configured |
| Live API contract smoke | no | skipped | 0s | set PROOF_BASE_URL or CONTRACT_SMOKE_BASE_URL |
| Live backend workflow smoke | no | skipped | 0s | set PROOF_BASE_URL or SMOKE_BASE_URL |
| Production object storage signed URL and cleanup proof | no | skipped | 0s | configure a non-local STORAGE_PROVIDER and its bucket credentials |
| PostgreSQL backup and isolated restore drill | no | skipped | 0s | set RESTORE_TEST_DATABASE_URL and ALLOW_RESTORE_TEST_DB=true |
| Production Docker image build | yes | passed | 24.1s |  |

Strict certification succeeds only when live API, PostgreSQL, Redis worker, cloud object storage, Docker, disaster recovery, approval, and rollback evidence all pass.
