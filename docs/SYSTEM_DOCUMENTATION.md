# KiranaOS implementation notes

See [ARCHITECTURE.md](../ARCHITECTURE.md) for system boundaries and [RELEASE_GATE.md](../RELEASE_GATE.md) for release evidence and remaining infrastructure checks. This document is an implementation map, not a certification or a guarantee of complete automation.

The React client keeps an IndexedDB replica and a durable outbox for supported offline operations. Express services validate requests, tenant access, permissions and accounting rules. Prisma supports local SQLite and production PostgreSQL. Offline browser speech recognition, payment providers, printers and deployment need their own environment-specific checks.

## Accountant access API foundation

The `/api/ca` endpoints and typed frontend API helpers are implemented. There is no accountant portal screen or navigation entry in this change.

An accountant signs in to their own owner account on an activated device. A client shop owner generates an invite with their owner PIN (`POST /generate-code`). The response contains a 192-bit code, shown only at creation; the database stores its SHA-256 hash, not the code. Invites expire after 1–72 hours and can be accepted once (`POST /link`). Retries by the same accountant are idempotent. Each grant authorizes only these read endpoints; it does not create a client-shop user or copy credentials. Email and phone matches confer no access.

Owners inspect grants with `GET /access` and revoke them with `DELETE /access/:id` plus their PIN. Creation, acceptance and revocation require an audit record in the same transaction. Portable shop-data restores preserve current access grants, so restoring old business records cannot reactivate a revoked grant. Full database disaster recovery still requires the normal post-restore credential/access review.

`GET /overview` includes the caller's own shop and explicitly linked clients. Totals are grouped by currency. Periods use each shop's accounting time zone. An empty or balanced operational summary is `not_reviewed`, never automatically certified or reconciled. Attention flags cover current open audit findings, the latest seven closing snapshots in the period, debtor balance repairs and unmatched tender totals; these are indicators, not a complete audit.

`GET /clients/:shopId` returns operational totals, recent closings and existing GST working papers. `GET /clients/:shopId/tally` uses the existing Tally exporter. Both enforce the target shop's feature entitlement. Existing country, tax-registration scope and data-integrity restrictions remain in force; errors are not replaced with empty reports. Exports are working papers, not filed tax returns.

Operational turnover includes active signed bills/returns, including estimates as in existing sales reports. Output tax excludes estimates and is not net tax payable after input credits. Outstanding customer debt is current, not a historical closing balance. Confirmed payment records and billed credit form the tender breakdown. Waivers are shown separately and reduce the unallocated amount; legacy credit payment rows are not counted twice. Arbitrary date ranges retain the API's `mtd` field names for compatibility; use `periodFrom`/`periodTo` when labeling them.

Requests accept either `month=YYYY-MM` or `from`/`to` dates, with an ordered range up to 366 days. Reports refuse more than 20,000 bills per shop instead of truncating totals. Portfolio reads are limited to 100 grants and processed sequentially to bound database concurrency. The owner access list returns the newest 100 grants.

## Dashboard report fallback

The dashboard loads server report fallbacks when the corresponding financial/local snapshot is unavailable. Cached or server-computed dashboard figures remain authoritative even when their values are zero. The debtor fallback remains available until a financial snapshot or local cache can supply it.

## Verification

Run the frontend production gate, backend full suite and production checks, migration safety checks, and PostgreSQL integration CI before release. The accountant integration tests exercise real HTTP requests and database writes, including tenant isolation, invite lifecycle, financial records and audit rollback. Passing these checks does not establish live payment, hardware, production deployment or customer-pilot readiness.
