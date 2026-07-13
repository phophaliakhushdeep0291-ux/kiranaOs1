# KiranaOS Release Certification

- Status: **failed**
- Mode: **ci**
- Commit: `2f0fbc1cdb758cc9053871cd0be551795b9cef5a`
- Branch: `main`
- Working tree dirty: **no**
- Started: 2026-07-13T15:11:18.078Z
- Completed: 2026-07-13T15:15:27.204Z

| Check | Required | Status | Duration | Detail |
| --- | --- | --- | ---: | --- |
| Release approval and rollback metadata | no | skipped | 0s | set RELEASE_VERSION, RELEASE_APPROVER, RELEASE_APPROVED=true, and RELEASE_ROLLBACK_IMAGE |
| Validate SQLite Prisma schema | yes | passed | 0.8s |  |
| Validate PostgreSQL Prisma schema | yes | passed | 0.8s |  |
| Migration safety and sequence | yes | passed | 0.2s |  |
| Release documentation and rollback gate | yes | passed | 0.1s |  |
| Backend source and calculation tests | yes | passed | 3.8s |  |
| Backend regression and integration tests (isolated SQLite) | yes | failed | 90s | type: 'test'       ...     # Subtest: sync pull for Shop A does not return Shop B data     ok 4 - sync pull for Shop A does not return Shop B data       ---       duration_ms: 824.286655       type: 'test'       ...     # Subtest: reports for Shop A do not include Shop B data     ok 5 - reports for Shop A do not include Shop B data       ---       duration_ms: 916.009971       type: 'test'       ...     1..5 ok 14 - cross-shop tenant isolation   ---   duration_ms: 4332.889998   type: 'suite'   ... 1..14 # tests 128 # suites 13 # pass 127 # fail 1 # cancelled 0 # skipped 0 # todo 0 # duration_ms 83383.178166 |
| Backend production readiness checks | yes | failed | 0.2s | Production readiness checks failed: - Column drift: "Customer.gstNumber" exists in PostgreSQL schema but is absent from migration SQL — run a new migration - Column drift: "Customer.stateCode" exists in PostgreSQL schema but is absent from migration SQL — run a new migration - Column drift: "Bill.buyerStateCode" exists in PostgreSQL schema but is absent from migration SQL — run a new migration - Column drift: "Bill.buyerAddress" exists in PostgreSQL schema but is absent from migration SQL — run a new migration |
| Static API contract proof | yes | passed | 0.1s |  |
| Razorpay signature fixture proof | yes | passed | 0.2s |  |
| Frontend typecheck, tests, build, and security checks | yes | failed | 26s | > kirana-os-frontend@0.0.0 prod:check > npm run typecheck && npm run test && npm run build && npm run security:check   > kirana-os-frontend@0.0.0 typecheck > tsc -p tsconfig.json --noEmit  src/features/loyalty/pages/LoyaltyPage.tsx(47,232): error TS2604: JSX element type 'Icon' does not have any construct or call signatures. src/features/loyalty/pages/LoyaltyPage.tsx(47,232): error TS2786: 'Icon' cannot be used as a JSX component.   Its type 'string \| number \| ForwardRefExoticComponent<Omit<LucideProps, "ref"> & RefAttributes<SVGSVGElement>>' is not a valid JSX element type.     Type 'number' is not assignable to type 'ElementType'. |
| Local object storage read/write/delete proof | yes | passed | 0.2s |  |
| PostgreSQL migrations, regression, integration, concurrency, and reconciliation | yes | failed | 98.4s | ❌ Failed: Run DB-backed integration and concurrency tests |
| Redis queue and worker execution proof | yes | failed | 0.5s | {"type":"worker_verify_failure","errorCode":"Error","errorMessage":"Custom Id cannot contain :","time":"2026-07-13T15:14:59.468Z"} |
| Deployed worker heartbeat freshness | no | skipped | 0s | start the production worker and set PROOF_REQUIRE_WORKER=true with Redis configured |
| Live API contract smoke | no | skipped | 0s | set PROOF_BASE_URL or CONTRACT_SMOKE_BASE_URL |
| Live backend workflow smoke | no | skipped | 0s | set PROOF_BASE_URL or SMOKE_BASE_URL |
| Production object storage signed URL and cleanup proof | no | skipped | 0s | configure a non-local STORAGE_PROVIDER and its bucket credentials |
| PostgreSQL backup and isolated restore drill | no | skipped | 0s | set RESTORE_TEST_DATABASE_URL and ALLOW_RESTORE_TEST_DB=true |
| Production Docker image build | yes | passed | 27.7s |  |

Strict certification succeeds only when live API, PostgreSQL, Redis worker, cloud object storage, Docker, disaster recovery, approval, and rollback evidence all pass.
