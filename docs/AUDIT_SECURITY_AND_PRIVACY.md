# Audit Security and Privacy

Scope: `backend/src/modules/assurance/**` and `frontend/src/features/assurance/**`.

## 1. Read-only toward canonical financial records

The engine may write to `Audit*` tables only. It never issues an INSERT, UPDATE or
DELETE against `Bill`, `BillItem`, `Payment`, `UdharLedger`, `StockLedger`,
`Product`, `Customer`, `Expense`, `PurchaseHistory`, `PurchaseReceipt`,
`FinancialLedger`, `DailyClosingSnapshot` or any other canonical table.

How this is enforced and proven:

- `context.service.js` performs only `findFirst`/`findMany` reads.
- No assurance code path opens a transaction that spans a canonical write.
- A test (`engine writes nothing to canonical financial tables`) snapshots every
  canonical table for a shop, evaluates a bill, a customer and a product, and
  asserts a byte-identical snapshot afterwards.
- The MVP acceptance test additionally asserts that the flagged bill's
  `paidAmount`, the flagged product's `stockBaseQty` and the flagged customer's
  `udharAmount` are unchanged after the engine flags them.

Findings recommend corrective action; they never take it. There is no
auto-correction path, no journal-adjustment writer, and no "fix it for me" button.
An engine-detected condition that later clears is resolved as `CORRECTED` with an
explicit system history row — visible, never silent.

## 2. Tenant isolation

- `shopId` comes **only** from the authenticated JWT via `requireShop`. No
  assurance endpoint reads a shop id from a header, body or query parameter.
- Every query filters on that `shopId`. A finding, run, evidence or requirement id
  from another shop resolves to **404**, never to data — asserted for read, patch,
  evidence-submit, review and assign in `assurance-api.integration.test.js`.
- Two places deliberately read *unscoped*: the bill context loads the referenced
  customer and products without a shop filter, selecting identity columns only, so
  that `BILL_CROSS_SHOP_REFERENCE` can detect a cross-tenant reference. The
  resulting finding records **that** the reference is foreign and the offending id,
  and never the other shop's `shopId` or names — asserted by test.
- `BILL_CROSS_SHOP_REFERENCE` is CRITICAL with a declared score floor of 85, so a
  tenant-isolation defect surfaces at the top of the dashboard regardless of amount.

## 3. Authorization

Chain on every route: `requireAuth` → `requireShop` → capability check.
`requireAuth` re-reads the user, session and device from the database on each
request, so a disabled staff member or revoked device loses access immediately.

| Product role | Repo role | Capabilities |
|---|---|---|
| OWNER | `owner` | view all, request/submit/verify evidence, review, resolve, close, assign, configure rules, trigger runs, view reports |
| MANAGER | `admin` | view all, submit evidence, review, trigger runs, view reports |
| AUDIT_REVIEWER | `audit_reviewer` | view all, request/submit/verify evidence, review, resolve, close, view reports |
| STAFF | `staff` | view **only findings assigned to them**, submit evidence/explanations |

Enforced negatives, all asserted by test: staff cannot see unassigned findings
(404), cannot close or declare a false positive (403), cannot assign, cannot change
rules; a manager cannot verify evidence and cannot set `FALSE_POSITIVE`,
`ACCEPTED_RISK` or `CLOSED`. Rule configuration additionally requires
`requireRole("owner")` at the route level.

Nobody — including the owner — can delete a finding, an evidence record or a
history row. There is no delete endpoint; `DELETE /api/audit/findings/:id`
returns 404.

## 4. Input validation, pagination, rate limits

- Zod schemas (`assurance.schema.js`) validate every body, query and the
  `entityType`/`entityId` path pair. Invalid risk levels, inverted date ranges,
  oversized page limits and unknown entity types are rejected with 400.
- List endpoints paginate (default 25, max 100) and return a `pagination` block.
- `/runs`, `/evaluate/*` and `/baselines/recompute` sit behind a per-shop-per-user
  limiter (30 / 15 min) on top of the global API limiter, because evaluation is
  the read-heavy path. `/findings/:id/explain` has its own limiter (60 / 15 min)
  because it can reach an external provider.
- Errors flow through the app's existing `errorHandler`, so no stack traces or
  internal details reach clients.

## 5. Audit logging of the audit module

Every state-changing assurance action writes an `AuditLog` row with actor, IP and
user agent: `AUDIT_RUN_STARTED`, `AUDIT_TRANSACTION_EVALUATED`,
`AUDIT_RANGE_EVALUATED`, `AUDIT_FINDING_STATUS_CHANGED`, `AUDIT_EVIDENCE_REQUESTED`,
`AUDIT_EVIDENCE_SUBMITTED`, `AUDIT_EVIDENCE_VERIFIED`, `AUDIT_FINDING_REVIEWED`,
`AUDIT_FINDING_ASSIGNED`, `AUDIT_RULE_UPDATED`. Logging failures never fail the
action. Asserted by test.

## 6. AI provider boundary and data minimization

Default configuration is **`AUDIT_AI_PROVIDER=disabled`**: no external call is
possible until someone deliberately changes it. Modes: `disabled | mock | groq | openai`.

Order of operations for every AI call, with no bypass:

1. Build a minimal fact payload from already-computed deterministic output.
2. **Redact** (`ai/redaction.js`).
3. Check provider availability **and** shop consent.
4. Call with a timeout (`AUDIT_AI_TIMEOUT_MS`, default 12 s) and a bounded retry
   budget (`AUDIT_AI_MAX_RETRIES`, default 1).
5. Validate the response against a zod schema.
6. Screen the text against a forbidden-phrase list.
7. On **any** failure, return the deterministic fallback explanation.

### What redaction removes

| Class | Treatment |
|---|---|
| Customer/staff/supplier names, addresses | key dropped entirely |
| Phone numbers | dropped as keys; masked inside free text |
| GSTIN | dropped; masked in free text |
| UPI IDs, email addresses | masked in free text |
| Account numbers (9–18 digits) | masked as `[redacted-number:Ndigits]` |
| Credentials, bearer tokens, API keys, JWTs | dropped and masked |
| Provider references | dropped (and already masked inside findings) |
| Evidence filenames, storage keys, reference values | dropped |
| File bytes / attachments | dropped unless `AUDIT_AI_ALLOW_ATTACHMENTS=true` |
| Entity ids (customer, bill, product, user, device, shop…) | replaced with stable per-call pseudonyms (`CUSTOMER_1`) |

Amounts, rule codes, comparisons and score inputs pass through — they are the
facts being explained and carry no identity.

Two guards sit after redaction: `containsLikelyPii()` re-scans the payload and
**refuses to dispatch** if anything still looks identifying, and the whole
redaction contract is asserted by test (names dropped, phones/UPI/accounts masked,
ids pseudonymised and stable, audit facts preserved, raw payload flagged, redacted
payload clean).

### Consent

With an external provider configured, `AUDIT_AI_REQUIRE_SHOP_CONSENT=true`
(default) means nothing is sent until that shop's own
`settingsJson.audit.aiExplanationsConsent === true`. Absent consent the call is
refused and the deterministic explanation is used.

### What the AI layer may never do

Calculate or dispute a number, modify a transaction, invent evidence, declare
fraud, give a statutory audit opinion, close a finding, or override a rule. It
receives only computed results and returns only prose. Provider output is rejected
outright if it contains accusation- or certification-shaped language ("fraud has
occurred", "guilty", "audit opinion", "chartered accountant", …) — asserted by
test — and any suggested evidence type not actually requested by a triggered rule
is filtered out. Stored explanations sit in `aiExplanation` **alongside**, never
instead of, `scoreBreakdownJson`, and every response carries a disclaimer.

## 7. Secrets

No `.env` value, database URL, JWT secret or API key is read into any assurance
response, log line, finding or explanation payload. Provider keys are read from
`env` at provider construction and never serialised. The dashboard exposes the AI
provider *name* and availability only.

## 8. Residual risks

1. **Findings concentrate sensitive facts.** A finding legitimately contains
   amounts, entity ids and rule details, so `/api/audit/*` is as sensitive as the
   reports module. It is protected by the same auth chain and, for staff, a
   stricter visibility filter than the rest of the product.
2. **Masked-but-present references.** Provider references are masked to their last
   four characters in closing findings. A reviewer with dashboard access can still
   correlate those with payment app data — which is the point of the control, but
   worth knowing.
3. **External provider trust.** With `groq`/`openai` enabled and consent given, a
   third party receives redacted, pseudonymised amounts and rule facts. There is
   no way to prove a provider does not retain them; that is why the default is
   `disabled` and consent is per shop.
4. **Staff-visibility inference.** A staff member assigned a finding sees that
   finding's details, including the amount and the rule's numbers. Assignment is
   therefore a deliberate act restricted to the owner.
5. **Dev-only base-URL override.** The frontend honours a `localStorage` API base
   URL in development only; production builds require `VITE_API_BASE_URL`. This is
   pre-existing behaviour, unchanged by this module.
