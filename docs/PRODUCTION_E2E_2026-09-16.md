# Production E2E hardening — 16 September 2026

This pass starts from merged main `71c849449ce2d83d29cfa9705af83218b2748ab5` and is developed on `work/production-e2e-readiness`.

## Bugs fixed

- **Repeated startup reloads.** The shell error boundary retried missing JavaScript chunks without the page boundary's guard. Both now share one automatic attempt per build and tab. Offline or blocked session storage keeps the recovery screen available; manual retry remains available. Tests cover concurrent failures, slow reloads, a new build, blocked storage, and shell remounts.
- **Temporary receipt number after successful sync.** The saved-sale screen and its printable receipt now follow the bill's local-to-server ID mapping and permanent bill number from the existing local cache. No additional API polling or full IndexedDB scan is introduced.
- **Mobile receipt actions disappeared.** Completing checkout closed the only panel containing Print and WhatsApp. An empty-cart saved-bill card now keeps receipt actions reachable, with the permanent number after sync.
- **Incorrect low-stock quantities.** Reports now respect a product's stored base unit and pack conversion, including litre-based legacy records and named packs. Low-stock classification compares unrounded stored quantities, avoiding rounding-induced false alarms. Legacy snapshots without base-unit metadata retain their existing conversion.
- Added accessible names to the bill-type selector, customer selector, and cash-tendered input using existing Hindi/English translations.

## End-to-end evidence

Browser testing used a dummy shop and an isolated SQLite database. The API was deliberately stopped during the credit-sale test. No production shop records or real payment providers were used.

| Flow | Observed result |
| --- | --- |
| Sign in and PIN unlock | Counter opened; product catalogue available |
| Cash sale | One ₹25 bill, one payment, stock reduced by one |
| Credit sale during API outage | Saved locally; customer balance became ₹25 |
| Repayment during API outage | One local ₹25 repayment; balance returned to ₹0 |
| API recovery | Automatic sync completed; server contained one debit and one repayment |
| Desktop receipt after sync | `PENDING-…` updated to `KOS-2026-000003` |
| Mobile checkout at 390 × 844 | Sale completed; `KOS-2026-000004` and receipt actions remained accessible |
| Final server reconciliation | Four distinct ₹25 bills, total sales ₹100, stock 30 → 26, customer balance ₹0 |

The assertions and screenshots are in [the evidence folder](evidence/production-e2e-2026-09-16/). [Server reconciliation](evidence/production-e2e-2026-09-16/browser-server-check.json) contains no credentials or session tokens.

A new repeatable HTTP integration test, `backend/tests/integration/counter-lifecycle.integration.test.js`, exercises product/customer creation, purchase receipt replay, a split-tender offline sale, identical and rebuilt event retries, customer repayment replay, partial return replay, and tenant isolation. It checks stock and customer balances through HTTP and verifies bill/payment/stock-ledger counts in the database. It is automatically discovered by the existing integration runner, including PostgreSQL CI.

Run it with:

```sh
cd backend
npm run test:integration -- counter-lifecycle.integration.test.js
```

The runner allocates and removes its own test database. Do not point test reset scripts at a real shop database.

## Release checks and limits

Local checks passed: frontend `npm run prod:check` (2,750 tests passed, 1 skipped; 6,104 translation keys; startup JavaScript 259.3 kB gzip), backend `npm run prod:check`, the new HTTP lifecycle test, source parsing, and repository hygiene. The production bundle also opened login, dashboard, reports, and inventory with no observed browser console errors. Exact results and file hashes are recorded in the [evidence manifest](evidence/production-e2e-2026-09-16/manifest.json).

The preceding PR #340 passed [release certification](https://github.com/phophaliakhushdeep0291-ux/kiranaOs1/actions/runs/35100008150) before this pass. That proves its prior revision, not the changes in this branch. The new PR must pass its own required checks.

The release workflow runs PostgreSQL, Redis, migration/restore, backend, and frontend proof in CI. Its pull-request and push runs explicitly skip Docker image proof; weekly/manual certification includes it. A green PR run must not be described as full image certification.

This is **not blanket approval for a paid production launch**. Remaining launch evidence must come from the intended deployment and devices:

1. Successful required CI for the release revision, plus strict/image certification where required.
2. Live checkout/webhook and password-recovery/email delivery with the actual provider configuration.
3. Successful scheduled backup and restore drill for the deployment, with monitoring and alert routing verified.
4. Target shop hardware checks: thermal printer, scanner, and any Windows installer/signing requirement.
5. Installed-PWA offline restart and multi-device conflict/recovery checks on supported devices. The local browser outage test proves API-unavailable selling and repayment; it does not prove an offline service-worker cold start on every device.

No production deployment, provider activation, hardware certification, or external customer message was performed in this pass.
