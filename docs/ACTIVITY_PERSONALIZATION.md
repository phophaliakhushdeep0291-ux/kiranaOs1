# User Activity & Personalization Engine (§13)

Behavioural event collection, the personalization layer it feeds, the AI
learning layer, and the business-intelligence surface.

All routes are mounted under `/api`, are **tenant-scoped by the `shopId` in the
JWT**, and follow the platform conventions (`{ success, data }`, `x-device-id`,
`requireRole`). The one exception is the public storefront ingest, documented in
§4 below.

---

## 1. What this is — and what it is not

| It is | It is not |
|---|---|
| A record of how the software is used | A financial record |
| A ranking that reorders and pre-fills | A gate that hides or decides |
| Deterministic counting, explained | A learned model or a black box |
| Lossy under pressure, by design | Something a bill may ever wait on |

Three invariants hold throughout the implementation:

1. **Telemetry never fails a user action.** Every entry point swallows its own
   errors and returns counts instead of throwing — the same contract
   `createAuditLog` and `recordErrorEvent` follow. A shopkeeper must never be
   unable to bill because analytics were unavailable.
2. **Nothing here is authoritative.** `ActivityAggregate` is a derived read model
   that can be rebuilt from `ActivityEvent`, and no money, stock or tax figure is
   ever read from either. Peak hours and lapsing customers deliberately read
   **bills**, not activity, because bills go back to the shop's first day.
3. **Thin evidence is reported as thin.** Below the minimum-observation floor a
   block returns empty with `sufficientData: false`, and the UI keeps its default
   ordering. "I don't have enough data yet" is a correct answer; a confident
   ranking built on four events is not.

---

## 2. Data model

### `ActivityEvent` — the append-only fact table

One row per meaningful action. Carries every attribute the spec lists:

| Column | Notes |
|---|---|
| `eventId` | **Client-generated, `@unique`.** The idempotency key — a retried offline batch cannot double-count |
| `eventType` | From the closed catalogue (`activity.events.js`) |
| `occurredAt` | Device time, sanity-bounded (see below). Distinct from `createdAt` (ingest time) |
| `shopId` / `userId` / `orgId` | From the JWT, never from the body |
| `deviceId` | Session's verified device; `x-device-id` only as fallback |
| `sessionId` / `screen` / `module` / `appVersion` / `networkStatus` | Context |
| `source` | `pos` \| `online` \| `server` |
| `durationMs` | Present where the operation was timed |
| `metadataJson` | Sanitized, byte-capped, event-specific fields |

**Clock skew.** A POS with a dead CMOS battery boots in 2010. `occurredAt` is
accepted up to 30 days late (a long offline stretch) but never more than a minute
into the future; anything outside that falls back to server time.

### `ActivityAggregate` — the counter read model

Recomputing "the ten products this user bills most" from millions of rows on
every keystroke is not viable on a counter PC, so ingest folds each event into
counters that the personalization endpoints read directly.

- `userId` uses the sentinel **`"*"`** for shop-wide rollups rather than `NULL`,
  because both SQLite and Postgres treat NULLs as distinct in a unique index —
  a nullable column would let every shop-wide upsert insert a duplicate instead
  of incrementing.
- `count` answers "how often, ever". **`score`** answers "how relevant now": a
  half-life decay (30 days) applied at write *and* read time, so a seasonal item
  stops being suggested in the off-season while a staple survives a quiet week.
- `totalMs` / `durationSamples` back the duration averages.

`kind` values: `product_billed`, `product_searched`, `search_query`, `report`,
`customer`, `payment_method`, `filter`, `page`, `online_product_view`,
`online_cart_add`, `feature`, `task_time`, `product_pair`, `abandoned_cart`.

---

## 3. Ingest — `POST /api/activity/events`

Any authenticated user. Answers **`202` always**, even when nothing was stored:
a POS must never show an error toast because a telemetry batch failed. The
response counts are how a client — and an operator — can still tell.

```json
{ "events": [
  { "eventId": "evt_9f3…", "eventType": "PRODUCT_SEARCH",
    "occurredAt": "2026-08-02T09:14:02.113Z", "sessionId": "ses_…",
    "screen": "/billing", "appVersion": "1.4.0", "networkStatus": "online",
    "durationMs": 1840,
    "metadata": { "query": "maggi", "results": 12, "selectedProduct": "Maggi 70g" } }
] }
```

→ `202 { "accepted": 1, "duplicates": 0, "rejected": 0, "aggregated": 2 }`

- **Batched**, max 100 events. A busy billing minute costs one request, not sixty.
- **Closed vocabulary.** An unrecognised `eventType` is rejected and counted, not
  stored. An open vocabulary makes the analytics surface unqueryable within a
  release or two: a typo silently becomes a new feature in the adoption report.
- **Never accepted from the client:** `shopId`, `userId`, `orgId`.

### Redaction

Activity has its **own** sanitizer (`sanitizeActivityMetadata`), not the error
store's. `sanitizeTelemetry` blanks `customerId`/`productId` — correct for a
stack trace, and exactly wrong here, where those ids *are* the signal; blanking
them collapses every counter into one `[REDACTED]` bucket.

So: identifier-shaped keys (`productId`, `customerIds`, `billId`, …) keep their
value — opaque, tenant-scoped cuids that mean nothing outside the shop that owns
them — and everything else, including the free text a human typed into a search
box, goes through the shared email/phone/token redaction. Identifier values are
additionally run through the phone pattern, which no cuid can match, so a caller
that mistakenly puts a phone number in an "id" field cannot persist it.

---

## 4. Storefront ingest — `POST /api/public/shops/:shopId/activity`

The QR self-order page is a public storefront with no login, so its events need
an unauthenticated route. It is boxed in four ways:

- **Type-restricted** — only `ONLINE_*` events. A caller cannot forge a `LOGIN`
  or a `BILL_CREATED` into a shop's history.
- **Opt-in** — the shop must have customer ordering enabled, and returns the same
  single `404` as the catalog for both "no such shop" and "not enabled", so it
  cannot be used to enumerate shop ids.
- **Attribution-free** — `userId` is always null. A shopper is not a staff member,
  and their browsing must never feed a staff member's personal suggestions.
- **Silent** — `202` regardless, including on a malformed body.

It also rides the global `/api` rate limiter like every other public route.

Client-side, each queued storefront event remembers **which** shop it was
recorded on. Without that, a shopper who opens two shops' QR pages in one session
would have the first shop's undelivered events posted to the second shop's
ingest — recording one store's browsing as another's.

---

## 5. Reads

| Endpoint | Role | Returns |
|---|---|---|
| `GET /api/activity/recent` | any | Recent searches, reports, customers, products, payment methods, filters, pages, online-viewed products, abandoned carts |
| `GET /api/activity/personalization` | any | The suggestion payload (below) |
| `GET /api/activity/replenishment` | any | Reorder suggestions, activity-ranked |
| `GET /api/activity/insights` | **owner** | The learning layer; `?question=…` answers one |
| `GET /api/activity/analytics` | **owner** | Business intelligence |

Ingest and the personal reads are open to any user of the shop — it is their own
behaviour, and the whole point is that it shapes their POS. Business intelligence
is owner-only: it aggregates every staff member's behaviour, which is the owner's
view of the business rather than a staff member's view of their own work.

### Personalization payload

| Field | Spec item | How it is derived |
|---|---|---|
| `quickProducts` | Prioritize frequently sold products | User's ranking leads; shop's ranking at half weight fills in behind it, so a new cashier on an established counter is useful from day one |
| `searchSuggestions` | Intelligent auto-complete | Past queries that led to a selection |
| `productCombos` | Commonly purchased combinations | Unordered basket pairs, shop-wide only (a combination is a property of the shop's customers, not of who rang it up). Capped at 12 lines per bill — pair count grows quadratically |
| `frequentCustomers` | Highlight frequent customers | Per-user selection counters |
| `preferredPaymentMethod` | Learn preferred payment | Top payment-method counter |
| `preferredFilters` | Retain preferred filters | Keyed by screen, so Products does not inherit Reports' filters |
| `dashboardOrder` | Reorder widgets by usage | Page + feature scores; unlisted widgets keep their default position, so a new widget never disappears |
| `predictedProducts` | Predict likely next products | What this user billed in this ±1 hour band over 60 days. Shop trade is time-shaped (milk at 7am, snacks at 6pm) and this stays fully explainable |
| `onlineTrending` / `onlineCartTrending` | Trending / online-informed suggestions | Shop-wide storefront counters |
| `abandonedCarts` | Abandoned-cart reminders | The raw material for the nudge — **sending** stays an explicit user action |

Replenishment reuses the existing deterministic purchase-order calculator for
quantities and reasoning; activity decides only the *ordering* (soonest depletion
first, then popularity). A second forecast here would eventually disagree with
the purchase-order screen, and two different answers to "how much should I buy"
is worse than one.

---

## 6. AI learning layer

Every question the spec lists is a deterministic computation. The assistant
*routes* a question to one and narrates the result — the same contract the
diagnostics assistant follows, and the reason its answers can be trusted with a
shopkeeper's inventory money.

| Question | Insight key | Source |
|---|---|---|
| What products do I sell the most? | `top_products` | Aggregates (user, falling back to shop) |
| Which reports do I access most frequently? | `top_reports` | Aggregates |
| Which tasks consume the most time? | `slowest_tasks` | Ranked by **total** time, not slowest single run — a 40-second task done 200×/day costs more than a 5-minute monthly one |
| What are my peak business hours? | `peak_hours` | **Bills**, not activity |
| Which products should I reorder? | `reorder` | Deterministic reorder engine |
| Which customers have reduced their visits? | `lapsing_customers` | **Bills**; a visit is a purchase. Only customers with ≥3 prior visits count — dropping from 1 to 0 is not a trend |
| Which products are viewed but not bought online? | `online_viewed_not_bought` | Views vs cart-adds, ≥5 views, <20% conversion |
| Where are customers dropping off during checkout? | `checkout_drop_off` | Stage-by-stage funnel, largest leak named |

These are checked **before** the existing intents in `answerAssistant`, because
they read as data questions to the classifier but are answered from activity
rather than from the sales tables — and the specific answer beats the generic one.

---

## 7. Business intelligence — `GET /api/activity/analytics`

DAU/WAU/MAU (+ stickiness), most/least used features, feature adoption rates,
average billing/checkout/search durations, slowest tasks, most searched, most
edited products, cancelled bills and reasons, common support issues, common
system errors, AI usage, voice usage, and the full online funnel with conversion,
cart-abandonment and checkout drop-off rates.

Notes that matter when reading the numbers:

- **Active users count distinct `userId`, not devices.** One shopkeeper with a
  counter PC and a phone is one active user; counting devices would quietly
  inflate every engagement number.
- **Adoption is per-user**, not a raw count, so one power user hammering a button
  cannot make a feature look adopted.
- **A rate with an empty denominator is `null`, not `0`.** "0% conversion" on a
  shop with no online sessions reads as a problem; "no data" reads as the truth.
- **Averages ignore untimed events** rather than averaging in nulls as zeros —
  the classic way to report a flatteringly fast POS that nobody experiences.
- **Metadata scans are capped at 5,000 rows.** A report that degrades to "based
  on the last N events" is better on a counter PC than one that locks the
  database while a queue of customers waits.
- Support and error rollups come from the **diagnostics store**, already grouped
  there, so the two screens cannot disagree about the same incident.

Surfaced at **Activity & Insights** (`/activity-insights`, owner-only).

---

## 8. Client SDK — `frontend/src/lib/activity`

`trackEvent(type, metadata, options)` is synchronous and does no work beyond
pushing onto an array: no await, no fetch, no JSON on the caller's stack. A timer
flushes batches; the queue is persisted to `localStorage` so events survive the
reload, crash or offline stretch they are often the only record of. The queue is
capped at 500 and drops the **oldest** first — a device left offline for a week
must not fill its storage quota and break the offline bill queue that shares it.

Failed batches stay queued; because ingest is idempotent on `eventId`, a retry
after an ambiguous failure (request landed, response lost) counts once.

| Helper | Purpose |
|---|---|
| `startTiming(type)` | Times an operation and emits once |
| `trackFeature(key, label)` | Adoption counter |
| `useScreenTracking(location)` | One `SCREEN_VIEW` per navigation, emitted on **leaving** so it carries dwell time; route params collapse to `:id` |
| `useSearchTracking(query, results)` | One event per *settled* search, attributed to what the user picked |
| `useReportView(report, label)` | One event per report open, guarded against re-render |
| `useOnlineSession(shopId, cart, ordered)` | Storefront session start/end + abandoned-cart detection |
| `useOnlineProductImpression(id, name)` | Counts a product as *seen* only when its card is genuinely on screen |
| `usePersonalization()` / `useRecentActivity()` | Suggestion reads: long staleness, no retry, no error surface |

Sessions live in `sessionStorage` (two tabs are two sessions), expire after 30
idle minutes, and are reset on login and logout so one person's work is never
recorded inside another's on a shared counter machine.

---

## 9. Instrumented events

`APP_LAUNCH`, `USER_LOGIN`, `USER_LOGOUT`, `SCREEN_VIEW`, `PRODUCT_SEARCH`,
`PRODUCT_VIEW`, `PRODUCT_ADDED_TO_BILL`, `PRODUCT_REMOVED_FROM_BILL`,
`BILL_CREATED`, `BILL_MODIFIED`, `BILL_CANCELLED`, `PAYMENT_COMPLETED`,
`CUSTOMER_SEARCH`, `CUSTOMER_SELECTED`, `INVENTORY_VIEW`, `INVENTORY_UPDATE`,
`PURCHASE_CREATED`, `REPORT_VIEW`, `REPORT_EXPORT`, `PDF_GENERATED`,
`SETTINGS_CHANGED`, `PRINTER_USED`, `BARCODE_SCANNED`, `VOICE_COMMAND_USED`,
`AI_ASSISTANT_QUERY`, `HELP_ARTICLE_VIEWED`, `ERROR_OCCURRED`, `SYNC_STARTED`,
`SYNC_COMPLETED`, `SYNC_FAILED`, `ONLINE_SESSION_START`, `ONLINE_SESSION_END`,
`ONLINE_PRODUCT_VIEW`, `ONLINE_CART_ADD`, `ONLINE_CART_ABANDONED`,
`ONLINE_CHECKOUT_STARTED`, `ONLINE_CHECKOUT_COMPLETED`, `ONLINE_PAYMENT_FAILED`,
`FEATURE_USED`, `TASK_COMPLETED`.

Two deliberate deviations from a naive reading of the spec:

- **`BILL_CREATED` is emitted at the point of no return, not on server ack.** The
  local-first path completes a sale on the device and syncs later; waiting for an
  ack would lose every offline bill from the activity record — exactly the shop
  that needs suggestions most.
- **Background sync records only its terminal outcome**, and only for cycles that
  moved something. A POS pushes on a timer; a start/finish pair per tick would
  bury every other event under sync noise. `SYNC_STARTED` is recorded for the
  user-requested sync, which is a real signal — it usually means they think
  something is wrong. This mirrors the audit trail's "one terminal row per
  non-empty batch" rule.

---

## 10. Event streaming

Activity publishes to the existing seam on topic **`artha.activity.event`**,
partitioned by `shopId` like every other topic. Fire-and-forget; with
`EVENT_BUS_PROVIDER=none` (the default) it is a counted no-op.

---

## 11. Tests

```bash
cd backend  && npm run test:activity   # ingest, aggregation, isolation, funnel, insights
cd frontend && npx vitest run src/tests/activity-tracking.test.ts
```

The backend suite proves idempotent ingest, the closed vocabulary, PII redaction
of a typed query, per-user and per-shop aggregation, decay ordering, tenant
isolation both ways, the storefront ingest's type and opt-in guards, funnel rate
arithmetic (including `null` for an empty denominator), question routing for all
eight spec questions, and that thin evidence is reported as thin.

The frontend suite proves the safety contract: tracking never throws, unique
event ids, persistence, oldest-first eviction, hold-don't-drop on failure, and
that one storefront's events are never delivered to another shop.

---

## 12. Deliberate gaps

- **`PDF_GENERATED` and `CUSTOMER_SEARCH` are in the catalogue but not yet raised
  at every call site.** Receipt printing is instrumented (`PRINTER_USED`, both
  the browser and thermal-bridge paths); the standalone PDF/share paths and the
  customer-list search box are not. Both are one `trackEvent` call each when
  those screens are next touched.
- **`ONLINE_PAYMENT_FAILED` currently means "order submission failed".** The
  storefront takes no money today; when it does, the payment failure belongs on
  the real payment result.
- **No retention job yet.** `ActivityEvent` grows without bound. Aggregates are
  the durable read model and events are rebuildable-from-nothing telemetry, so a
  scheduled prune (say, 180 days) is the natural next step and is not wired.
