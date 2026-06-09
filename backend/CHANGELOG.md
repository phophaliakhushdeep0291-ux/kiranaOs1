# Changelog

## [1.0.0] - 2026-06-06

### Added
- Phase 29 release gate for safe SaaS rollout.
- Migration safety checker for PostgreSQL migration folders and destructive SQL patterns.
- Release manifest generator for deployment evidence.
- Release runbook, rollback plan, and production launch gate checklist.

### Changed
- Operational proof can now include release-gate checks before live rollout.
- Backend CI now runs migration safety and release-gate checks.
- Docker image copies API contract files so contract proof can run inside the image.

### Fixed
- Reduced risk of deploying migrations without documented backup, restore drill, rollback image, and health-gate checks.

### Operational
- Before selling to real shops, run `npm run proof:release` plus the live PostgreSQL, Redis worker, Razorpay test-mode, and frontend-backend E2E checks described in docs.
