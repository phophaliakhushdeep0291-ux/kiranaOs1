# Injection and dependency review — 10 October 2026

Scope: application SQL construction, provider URLs, stored document previews, authentication/tenant boundaries and dependencies on main 64c635f0. This is a source review and local regression verification, not a penetration-test certification or proof of a deployed fix.

## Changes

- QR image URLs must use HTTPS on rzp.io with no credentials or nonstandard port. The fetch boundary revalidates the URL and continues to reject redirects.
- QR response bodies are bounded while streaming and cancelled at 2 MiB. Previously the size check followed an unbounded arrayBuffer allocation for responses without Content-Length.
- Razorpay and Flipkart requests reject redirects; Razorpay API calls have a 20-second timeout.
- Store document previews validate the MIME type and base64 data URL and use DOM element attributes instead of document.write. Stored preferences containing an injected attribute, external URL, script URL or HTML document are refused. Legitimate offline PDF/image previews remain supported; the new window's opener is cleared.
- Patched backend dependencies: axios 1.20.0, compression 1.8.2 and proxy-addr 2.0.8. Patched frontend build dependencies: sharp 0.35.5, source-map-js 1.2.2 and postcss-selector-parser 7.1.6.
- CI audits backend production dependencies and all frontend/build dependencies, failing on high/critical findings.

## SQL and access boundaries

Reviewed application raw queries use fixed SQL with bound arguments, including calls named queryRawUnsafe. Their names alone do not indicate injection. Ordinary application queries use Prisma model APIs. No exploitable SQL injection was confirmed in the reviewed paths.

A new integration test stores SQL syntax as a customer name, searches it through HTTP, checks that OR 1=1 does not broaden the result, rejects an injected record ID, and confirms both tenants' records remain intact. Existing cross-shop and authentication tests cover unauthorized reads/writes, sync and reports, session revocation and audited credential changes.

## Verification

- Isolated SQLite SQL-injection regression and all five cross-shop isolation tests passed.
- Authentication integration: 12 tests passed.
- Retail payment/provider tests, QR parser tests, query-parser security regressions and security middleware checks passed.
- Backend production and frontend/build dependency audits: zero advisories reported on 10 October 2026.
- Frontend production gate passed under Node 22 with VITE_API_BASE_URL=/api: typecheck, translations, build, bundle/offline production checks, and 3,460 tests passed (one existing skip).
- Both Flipkart integration tests passed, including assertions that all provider requests reject redirects.

## Release limits

The changes must be merged and deployed before running instances receive them. Production data, credentials and live payments were not used or modified. Deployment headers, reverse-proxy trust, database access, network egress and secret rotation still require environment-specific verification. This review does not certify every route or prove absence of vulnerabilities. Merchant sandbox checks should confirm that legitimate provider responses do not require redirects before rollout.

References: [OWASP SSRF prevention](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html), [proxy-addr advisory](https://github.com/advisories/GHSA-jqcg-44mw-7w3h).
