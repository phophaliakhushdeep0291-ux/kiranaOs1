# Reviewed local QA evidence — 21 September 2026

See [the readiness report](../../DEPLOYMENT_READINESS_2026-09-21.md) for the candidate and limitations. All business records are synthetic local test data. No passwords, PINs, authentication tokens, database files or full application logs are retained here.

- `verification-summary.txt`: final completed frontend/backend/integration checks. Backend at `54912196`; frontend includes the payment-choice and settlement-display delta in the containing revision.
- `purchase-reconciliation.json`, `purchase-final.txt`, `sync-final.txt`: 21 September browser purchase and read-only server reconciliation. ₹30 paid as net ₹10 cash + ₹20 UPI, due 0, stock 36 → 39. Two pre-existing stock conflicts from 18 September remain open; no new conflict was created. The UPI reversal/re-record at the end tests the new explicit payment control, leaving net amounts unchanged.
- `manufacturing-reconciliation.json`: 17–18 September production, two partial shipments, two invoices and whole-order return. Stock, lots and payments reconcile.
- `kirana-offline-reconciliation.json`, `restaurant-reconciliation.json`: earlier offline cash/reconnect outcomes from 17–18 September. These are point-in-time counts before later QA transactions.
- `credit-purchase-reconciliation.json`: 18 September credit collection/return and first two purchase settlements. One earlier repair record belongs to a defect reproduction; the fresh return cycle created none.
- `closing-final.txt`: fresh 21 September closing shows supplier cash ₹10 and UPI ₹20; expected cash is −₹10 with no opening float entered for this test day. No physical drawer count was asserted.
- `manifest.json`: SHA-256 hashes of the retained files and final frontend implementation files. Hashes identify reviewed content; they do not certify a deployment.

The final local runs supersede interrupted/in-progress attempts. The backend suite retains the real concurrency assertions after removal of a machine-speed-only timing check. Three integration skips require PostgreSQL. Real hardware, cold restart, deployed worker/storage/restore and exact-candidate CI proof remain open.
