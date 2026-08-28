# Restaurant marketplaces: foundation, not a live connector

## Current delivery

- Restaurant owners can save Zomato/Swiggy outlet IDs for active branches in Settings → Integrations. Saving requires owner approval and an audit record. It neither submits a partner application nor proves ownership.
- Both provider adapters are **unimplemented**. The verification endpoint returns `503 MARKETPLACE_ADAPTER_REQUIRED`. No API key, settings flag, environment variable or editable URL can bypass this.
- Restaurant **Orders Received remains hidden**. QR/table orders continue through Tables and Kitchen; other POS types keep their existing order inbox.
- Internal, unexposed services stage authenticated normalized orders, deduplicate event and order IDs, validate integer-paise totals, and queue acceptance/rejection/ready commands. A simulator exercises this boundary in isolated tests; it is not either provider's wire format.
- There is no public marketplace webhook, worker, live command UI, kitchen ticket creation, bill posting or automatic settlement from this foundation. Existing QR ordering is unchanged.

## Required before activation

1. Obtain official merchant/POS partner approval, the complete current payload/authentication specifications, sandbox access, and provider-authorized restaurant mappings. An outlet ID or consumer ordering API does not prove merchant POS access.
2. Implement provider-specific raw-body authentication, replay handling, size/rate limits, key rotation and secret redaction. Securely configure credentials per the provider contract. Ownership verification must prove the requesting shop and branch, not merely that an outlet exists or a global API key works.
3. Explicitly map menu items, portions, add-ons, discounts, taxes and payment collection responsibility. Reject unsupported/ambiguous mappings; never guess tax or cash collection from an order total. The internal fixture schema currently supports simple integer-quantity lines, not all provider modifier/pricing variants.
4. Wire marketplace orders into the restaurant's kitchen/billing flow with one immutable provider identity and exactly one business posting. Distinguish provider-collected payments, cash-on-delivery responsibility, restaurant receipts, platform fees and later settlement. This stage currently changes none of those ledgers.
5. Implement bounded provider requests, provider-specific retry/reconciliation, order expiry/rejection rules, cancellation and modification decisions, refunds, and the worker. A command is claimed once before sending. A timeout/invalid acknowledgement becomes `needs_review`; a process crash may leave `sending`. Neither is automatically resent. A reviewed recovery path is required before enabling a worker.
6. Complete sandbox end-to-end tests and provider-required certification/pilot. Register the reviewed adapter version and enable `fulfilmentReady` only after the entire path is implemented and verified. Match current adapter version and verified live outlet proof before showing Orders Received.

## Integrity and operations

- All user setup routes require authentication, activated device, owner role and shop scoping. Mutations also require the owner PIN (subject to the application's existing development-only PIN bypass) and are blocked during maintenance.
- Pending outlet IDs are not globally reserved: an unverified owner cannot squat another restaurant's ID. Verified `(provider, environment, outlet)` bindings are exclusive, using a partial unique database index as well as transactional checks.
- Apply both the schema migration and generated client in a release. Production PostgreSQL migration: `000124_restaurant_marketplace_foundation`. Development SQLite: `20260828200000_restaurant_marketplace_foundation`. A plain schema push does not install the partial index.
- Provider event IDs cannot be reused with changed content. Repeated immutable order deliveries do not reopen closed orders. A status event received before its order is rejected for retry/reconciliation, not silently discarded.
- Provider network calls run outside database transactions. A late acceptance cannot overwrite a cancellation. Pending provider actions are stopped when an order closes. Unknown outcomes require reconciliation, not an optimistic local success badge.
- Transport receipts, outlet bindings, staged provider snapshots and command delivery claims are preserved during a shop business-data restore so restore cannot resend acknowledged actions. Full database backup remains necessary. Cross-system reconciliation after restore is part of the future activation runbook.
- No raw credentials, provider payloads or error messages are stored in command failures/audit metadata. Normalized order instructions can contain guest data: define provider-appropriate retention before activation.

## Verification

Run `npm run test:restaurant-marketplace` from `backend`; `npm run test:restaurant` includes it alongside QR, cancellation, kitchen and billing regressions. Tests use an isolated database and an injected internal simulator, never live partner services or customer orders. The HTTP test uses the real application and checks authentication, activated-device, owner-role, PIN and strict body validation.

Frontend checks cover rendered restaurant/owner visibility and unavailable/pending wording, plus static owner-approval and save-payload contracts. Production build and language parity checks are also required. Passing these tests does **not** certify a live provider integration.

Local verification on 2026-08-29: 15 simulator scenario groups; real-application HTTP access-control tests; restaurant billing, kitchen and guest-cancellation regressions; 2,027 frontend tests passed (one skipped); production frontend build and bundle checks; 177 API contract entries; backup coverage for 129 tenant models; PostgreSQL schema validation and replay-safety checks. PostgreSQL migration execution, real provider traffic, live payment settlement and production deployment were **not** exercised by this run.

## Official starting points

- [Zomato POS onboarding forms](https://www.zomato.com/developer/integration/docs/getting-started/forms/)
- [Zomato pre-integration requirements](https://www.zomato.com/developer/integration/docs/getting-started/development-for-integration/pre-integration/)
- [Zomato order-management overview](https://www.zomato.com/developer/integration/docs/api-documentation/order-management/)
- [Swiggy merchant partner portal](https://partner.swiggy.com/food/) — request merchant POS partner access; this is not a public order-ingestion API specification.

This is local feature-branch work until explicitly released. Do not describe these screens as a live Zomato/Swiggy connection when demonstrating or selling the app.
