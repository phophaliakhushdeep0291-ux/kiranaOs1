# Diagnostics & AI Support — API Reference

Everything the diagnostics, monitoring and support stack exposes. All routes are
mounted under `/api`, require a Bearer access token unless stated otherwise, and
are **tenant-scoped by the `shopId` in the JWT** — no endpoint accepts a shopId
from the client.

Conventions used throughout:

| Convention | Value |
|---|---|
| Success envelope | `{ "success": true, "data": … }` |
| Error envelope | `{ "success": false, "message": …, "code": … }` |
| Device identity | `x-device-id` request header |
| Roles | `owner`, `admin`, `staff` (route-level via `requireRole`) |
| Ingest failure policy | Ingest endpoints answer `202` and never fail the caller |

---

## 1. Module map

| Module | Path | Spec section | Responsibility |
|---|---|---|---|
| Logging | `lib/errorTracking.js`, `lib/logger.js` | §1 | Redaction + Sentry forwarding |
| Monitoring | `modules/diagnostics` | §1 | Own-backend error store, grouping |
| Diagnostics | `modules/diagnostics` | §5, §6 | Incident context, root-cause analysis |
| Sync | `modules/sync` | §3 | Sync health + plain-language failure causes |
| Devices | `modules/devices` | §4 | Device health telemetry + scoring |
| AI | `modules/diagnostics/assistant.service.js` | §5, §8, §9 | Intent routing, grounded answers |
| Reporting | `modules/reports` | §9 | CSV / PDF / Excel exports |
| Support | `modules/diagnostics` | §7 | Report-Issue requests + context bundles |
| Admin | `modules/platform-admin` | §10 | Cross-shop operator rollups |
| Remote support | `modules/remote-support` | §10a | Consent-gated remote diagnosis + repair |
| Auto-fix | `modules/remote-support/playbooks.*` | §10b | Known problem → known fix, dispatched unattended |
| Events | `lib/eventBus.js` | §11 | Kafka-compatible streaming seam |

---

## 2. Error monitoring — `/api/diagnostics` (§1)

### `POST /api/diagnostics/errors`
Ingest a client-side error. Any authenticated user. Always `202`, even on
internal failure — telemetry must never surface as a user-visible error.

```json
{
  "message": "Cannot read properties of null",
  "stack": "TypeError: …",
  "errorCode": "TypeError",
  "source": "frontend",
  "endpoint": "/api/bills",
  "functionName": "createBill",
  "fileName": "bills.tsx",
  "lineNumber": 142,
  "appVersion": "1.4.0",
  "os": "Windows 11",
  "browser": "Chrome 139",
  "networkStatus": "online",
  "onlineMode": true,
  "memoryUsageMb": 412,
  "route": "/billing"
}
```

Grouping: the server computes a fingerprint from
`source + normalizedMessage + errorCode + topStackFrame`, with digits stripped
from the message, so "Product 982 missing" and "Product 17 missing" collapse into
one `ErrorGroup` whose `count` increments. The fingerprint includes `shopId`, so
two shops never share a group.

Redaction: `sanitizeText`/`sanitizeTelemetry` strip emails, phone numbers, tokens
and query strings **before** anything is persisted or forwarded to Sentry.

### `GET /api/diagnostics/errors` · owner
Grouped issues for the shop, newest-active first.

### `GET /api/diagnostics/errors/:id` · owner
One group plus its recent individual occurrences.

---

## 3. Audit timeline (§2)

Written server-side via `createAuditLog(...)`; there is no client ingest route —
the timeline must not be forgeable.

Every entry carries the spec's required columns:

| Column | Source |
|---|---|
| Timestamp | `createdAt` |
| User | `userId` |
| Shop | `shopId` |
| Device | `deviceId` (explicit, else `x-device-id`) |
| Module | `module` (explicit, else inferred from the action name) |
| Previous value | `beforeJson` |
| New value | `afterJson` |
| Result | `result` — `success` \| `failure` |
| Duration | `durationMs` |

Modules: `auth, billing, payments, inventory, customers, suppliers, devices,
sync, settings, reports, expenses, finance, offers, loyalty, backup, assurance,
support, orders, other`.

For timed or fallible work, wrap the operation instead of hand-rolling timing —
success and failure are both recorded, and the original error still propagates:

```js
await withAudit(
  { shopId, userId, action: "BACKUP_RESTORED", req },
  () => restoreBackup(input),
);
```

Covered events include login, logout, bill create/edit/delete/restore, payment
received, inventory and stock adjustments, customer/supplier creation, sync
completed/failed, device registered/removed, and settings changed.

> **Sync runs record one terminal event per non-empty batch** (`SYNC_COMPLETED`
> or `SYNC_FAILED`) carrying `durationMs`, rather than a separate "started" row.
> The start instant is `createdAt - durationMs`, so no information is lost, and
> devices pushing on a timer across thousands of stores do not double the write
> volume on a hot path. Idle (empty) batches are not audited at all.

---

## 4. Sync diagnostics — `/api/sync/diagnostics` (§3)

`GET`, requires an activated device. Returns:

```json
{
  "lastSuccessfulSyncAt": "2026-08-02T06:12:00.000Z",
  "counts": { "pending": 2, "failed": 1, "conflicts": 0, "duplicates": 4, "retryAttempts": 3 },
  "recentFailures": [
    {
      "type": "UPDATE_INVENTORY",
      "explanation": "Updating inventory failed because the product no longer exists (Product 982).",
      "code": "SYNC_ENTITY_MISSING",
      "retryable": false
    }
  ],
  "recentConflicts": []
}
```

Every failure is explained in plain language by `sync-explain.js`, which resolves
a cause from the event type, the classifier reason code, the stored error string
and the payload's entity reference. A bare "Sync Error" is never returned.

---

## 5. Device health — `/api/devices/health` (§4)

| Route | Role | Purpose |
|---|---|---|
| `POST /api/devices/health` | any | Ingest a snapshot (`202`, never throws) |
| `GET /api/devices/health` | owner, admin | Latest snapshot per device |
| `GET /api/devices/health/me` | any | This device's latest snapshot |

Tracked: printer, internet/network type, database health, storage used vs quota,
app version, battery level and charging state, RAM usage, OS/browser. The server
derives `overallStatus` and a 0–100 `healthScore` with explainable `reasons`, so
the score can always be justified to a store owner.

---

## 6. AI assistant — `POST /api/diagnostics/assistant` (§5, §8, §9)

One endpoint, three intents, classified from the question:

| Intent | Trigger | Behaviour |
|---|---|---|
| `troubleshoot` | problem words ("not working", "failed") | Reads real diagnostics via the incident report, returns a grounded cause + steps + confidence |
| `howto` | question words | Matches the curated help-article set (§8) |
| `data` | business-data words | Answers from existing report services (§9) |

```json
{ "question": "my bills are not syncing" }
```

```json
{
  "intent": "troubleshoot",
  "answer": "2 events are stuck: updating inventory failed because the product no longer exists (Product 982).",
  "steps": ["Open Sync Status", "Retry the failed events", "…"],
  "confidence": 0.82,
  "escalate": false,
  "incidentReport": null
}
```

Data questions reuse the **existing, already-correct** services
(`getUdharSummary`, `getSalesSummary`) rather than generating SQL, so the
assistant cannot report a number the reports screen disagrees with. When
confidence is low it sets `escalate: true` and attaches the full incident report.

An LLM narrative is optional everywhere: with no `GROQ_API_KEY`/`OPENAI_API_KEY`
the assistant still answers deterministically.

---

## 7. Incident report — `GET /api/diagnostics/incident-report` (§6)

Owner only. Query: `?problem=<free text>&deviceId=<optional>`.

Sections: problem summary, recent user actions (now with module/result/duration),
recent failed actions, recent errors, recent sync events, device information,
network information, database status, possible root cause, suggested solution,
and a confidence score with the signals that produced it.

Deterministic without an AI key; an `aiNarrative` is added when one is present.

---

## 8. Support requests — `POST /api/diagnostics/support-requests` (§7)

The user types only a description; the client attaches recent logs, API
breadcrumbs, errors, sync summary, device info, current page and app version.
Screenshots are opt-in. The server auto-attaches a compact `serverDiagnosis`
(fast path, `useAi: false`) so triage starts with a hypothesis already in hand.

`GET /api/diagnostics/support-requests` · owner — lists the shop's reports.

---

## 9. Reporting exports — `/api/reports/exports` (§9)

`POST` with a `reportType`; the job is queued (or run inline when queues are
off), and the finished file is fetched from
`GET /api/reports/exports/:id/download`.

| Report type | Format | MIME |
|---|---|---|
| `bills_csv`, `stock_csv`, `udhar_csv`, `daily_closing_csv`, `sales_summary_csv` | CSV | `text/csv; charset=utf-8` |
| `gst_summary_pdf` | PDF | `application/pdf` |
| `customer_outstanding_pdf` | PDF | `application/pdf` |
| `customer_outstanding_xlsx`, `bills_xlsx`, `stock_xlsx`, `sales_summary_xlsx` | Excel | `…spreadsheetml.sheet` |

PDF and Excel are produced by dependency-free writers in `lib/documents/`
(`pdf.js`, `xlsx.js`) — no `pdfkit`/`exceljs` in the dependency tree. The format
is derived from the report type's suffix, so registering a new type in
`REPORT_EXPORT_TYPES` is enough for storage, MIME and download headers to follow.

---

## 10. Platform admin — `/api/platform-admin` (§10)

Cross-tenant, and therefore gated twice.

| Route | Access |
|---|---|
| `GET /api/platform-admin/access` | any authenticated user — a whoami probe returning `{ isPlatformAdmin }` |
| `GET /api/platform-admin/overview` | `requirePlatformAdmin` only |

`requirePlatformAdmin` re-resolves the caller's email from the database and
checks it against the `PLATFORM_ADMIN_EMAILS` allowlist. **An empty allowlist
means nobody is a platform admin** — the feature is off by default, and this is
the only place cross-tenant reads are permitted.

Overview returns: total/online/offline shops, device counts, crashes in the last
24h, sync failures and conflicts, top error groups, failing endpoints, app
version spread, recent support requests, worst-health stores, queue/Redis status
and event-bus status.

---

## 10a. Remote support — `/api/support` + `/api/platform-admin/support`

Diagnosis without a visit is §1–§10. This is repair without a visit: the operator
sees one shop and can queue fixes for its devices, without anyone travelling.

**Consent is the whole design.** A platform admin with no live session sees only
the anonymous rollup in §10. Access begins when the *owner* taps "Get remote help"
and reads out a 6-digit code, and it ends on a timer, on revoke, or on disconnect.

| Route | Access | Purpose |
|---|---|---|
| `POST /api/support/sessions` | owner | Issue a code. Returns the plaintext **once** |
| `GET /api/support/state` | owner | Who is connected, what they have run |
| `DELETE /api/support/sessions/:id` | owner | Stop button — also cancels queued commands |
| `GET /api/support/commands` | any (device) | Drain this device's queue |
| `POST /api/support/commands/:id/ack` | any (device) | Report the outcome |
| `GET /api/platform-admin/support/catalog` | admin | The command allowlist |
| `POST /api/platform-admin/support/redeem` | admin | Code → session |
| `GET …/support/sessions/:id/diagnostics` | admin + live session | One shop's full picture |
| `POST /api/platform-admin/support/commands` | admin + live session | Queue a fix |
| `DELETE …/support/sessions/:id` | admin + live session | Disconnect |

Scopes: `diagnose` (look only) and `repair`. The owner picks which one the code
grants.

### The command allowlist

`modules/remote-support/commands.catalog.js` is the complete set. Every entry maps
to a function the app **already runs locally** when the owner taps the equivalent
button; remote support drives existing code paths and opens no new ones.

| Command | Scope | Runs |
|---|---|---|
| `COLLECT_DIAGNOSTICS` | diagnose | `collectDeviceHealth` + `reportDeviceHealth` |
| `RUN_SYNC_NOW` | repair | `runSyncCycle` |
| `RETRY_FAILED_SYNC` | repair | `retryFailedSyncOperations` |
| `PULL_FROM_CLOUD` | repair | `hydrateFromBackendSnapshot` |
| `CLEAR_LOCAL_CACHE` | repair | `clearInstantMemoryCache` |
| `REFRESH_APP` | repair | `recoverFromStaleDeploy` |

Enforced **three times** — when queued, when handed to a device, and by the device
itself, which only has code for these six. A row inserted straight into the table
is cancelled rather than delivered.

Deliberately absent, and to stay absent: anything reading or writing financial
records. An operator can make sync work; they cannot touch a bill, a payment or a
customer's udhar. That is what keeps the audit engine's read-only-toward-financial-
data guarantee true.

### Guarantees worth knowing

- **The code is never stored in the clear** — only a `JWT_SECRET`-peppered SHA-256.
  A database dump yields no usable live codes. Losing the code costs one tap.
- **One live session per shop**, so "is support in my shop right now?" has one answer.
- **shopId comes from the session row**, never from the operator's request.
- **Revoke cancels queued work**, so withdrawing consent reaches commands already
  in flight.
- **Session expiry bounds the operator's access, not work already authorised.** A
  queued command survives to its own 6-hour TTL, because the device it targets is
  very often offline — which is the case this feature exists for.
- **Every action is audited** under the operator's email: `SUPPORT_SESSION_GRANTED`,
  `_OPENED`, `_REVOKED`, `_CLOSED`, `SUPPORT_COMMAND_ISSUED`, `_EXECUTED`.

### Delivery

Commands ride the device's existing sync poll — no socket, no new timer. The drain
sits **above** the subscription gate in `runSyncCycle`, because a shop whose sync is
switched off is among the likeliest to have called support, and a repair channel
that dies with the thing being repaired is no channel at all.

`REFRESH_APP` acks *before* reloading; after the reload there is no runtime left to
report with, and the operator would otherwise re-issue it forever.

UI: owner at `/help` (owner role only), operator at `/platform-admin/support`.

---

## 10b. Auto-dispatch playbooks — `modules/remote-support/playbooks.*`

§10a is a channel: it can carry a repair to a device but has no opinion about
which repair. This is the opinion — known problem → known fix, so support stops
re-diagnosing the same five problems by hand.

A playbook is a pure `match(signals)` over data the server already collects, plus
the one catalog command that fixes it.

### The catalog

| Playbook | Fires on | Command | Tier |
|---|---|---|---|
| `retry-stuck-sync` | ≥1 **retryable** sync failure | `RETRY_FAILED_SYNC` | auto |
| `device-not-syncing` | online, but no sync in 2h with work waiting | `RUN_SYNC_NOW` | auto |
| `refresh-stale-diagnostics` | health snapshot >12h old, or none ever | `COLLECT_DIAGNOSTICS` | auto |
| `stale-deploy-chunk-error` | chunk-load / dynamic-import error | `REFRESH_APP` | suggest |
| `stale-app-version` | behind the shop's other devices | `REFRESH_APP` | suggest |
| `local-database-degraded` | `dbStatus` error/degraded | `PULL_FROM_CLOUD` | suggest |

### Tiers — the line that matters

- **`auto`** — idempotent, non-disruptive, identical to a button the owner could
  safely tap mid-sale. Dispatched with no human involved.
- **`suggest`** — correct, but disruptive or heavy. Shown to an operator; never
  fired automatically.

The split is **not** "how confident are we", it is "what does the shopkeeper lose
if we are wrong". A needless retry costs nothing. A needless reload can drop a
half-built bill in front of a waiting customer — which is why every `REFRESH_APP`
and `PULL_FROM_CLOUD` playbook is suggest-tier, and a test asserts that no future
playbook can quietly make a disruptive command automatic.

### Restraint (most of the engine)

Deciding to run a fix is three lines; the rest stops it becoming an outage source.

| Guard | Effect |
|---|---|
| Owner opt-out | `settingsJson.autoFix.enabled` (default on) — checked per dispatch, so switching it off takes effect on the next evaluation |
| Per-playbook cooldown | 15 min – 12 h; no re-fire inside it |
| Evaluation throttle | 5 min per device, so a polling fleet does not re-run the signal queries every cycle |
| Circuit breaker | 3 consecutive failed/expired attempts → stop and leave the problem visible |
| Device scope | Unknown or foreign device → nothing queued |

Cooldown and the breaker are both read from the `DeviceCommand` rows themselves
(`playbookId` + `createdAt` + `status`), so the history *is* the state — there is
no counter that can drift from what actually ran.

### Consent

Auto-dispatch is the one path with no owner-granted session, and it is defensible
only because of what it is limited to: **no human sees the shop's data**, and the
command is one the app already runs on its own behalf. It is self-healing, not
remote access. Every dispatch is audited as `SUPPORT_AUTOFIX_DISPATCHED` with its
evidence, appears in the owner's "what has been done" list flagged
`automatic: true`, and the owner can switch the whole thing off.

### Where it runs

On `GET /api/support/commands` — **before** claiming, and awaited. A fix decided on
this poll ships on this same poll, and the device being there is the freshest signal
we will ever get that it is online.

Operators see the same matches (both tiers, with evidence) in the
`sessions/:id/diagnostics` response, following whichever device they have selected.

```bash
npm run test:remote-support   # includes matching, cooldown, breaker, opt-out (§10b)
```

---

## 11. Event streaming — `lib/eventBus.js` (§11)

A seam, not a broker. Domain code calls `publishEvent(topic, shopId, payload)`
and stays unaware of the transport.

```js
await publishEvent(EVENT_TOPICS.SYNC_FAILED, shopId, { failed: 3 });
```

| Setting | Values | Default |
|---|---|---|
| `EVENT_BUS_PROVIDER` | `none` \| `redis` \| `kafka` | `none` |

- **`none`** — counted no-op. The platform behaves exactly as before.
- **`redis`** — Redis Streams (`XADD` with `MAXLEN ~ 10000`): an append-only log
  with ids, ranges and consumer groups, the closest available Kafka analogue.
  Needs `REDIS_URL` and nothing else — in particular it does **not** require
  `QUEUES_ENABLED`, since BullMQ job queues are a separate concern.
- **`kafka`** — reserved. Returns `KAFKA_PROVIDER_NOT_INSTALLED` rather than
  pulling a broker client into the tree before the platform needs one.

The record is Kafka's producer shape — `{ topic, key, value, headers, timestamp }` —
so adopting Kafka is a transport swap, not a rewrite. **`key` is always the
shopId**, which keeps one store's events ordered within a partition and stops a
busy store from spraying across all of them.

Topics: `artha.diagnostics.error`, `artha.support.request`, `artha.sync.failed`,
`artha.sync.completed`, `artha.device.health`, `artha.audit.event`.

Publishing is fire-and-forget and never throws into the caller; drops and
failures are counted and exposed on the admin overview.

---

## 12. Configuration

| Variable | Default | Effect when unset |
|---|---|---|
| `PLATFORM_ADMIN_EMAILS` | empty | Admin dashboard is off — nobody is an admin |
| `EVENT_BUS_PROVIDER` | `none` | Events are counted and dropped |
| `REDIS_URL` | — | Redis features (incl. the redis bus) stay off |
| `QUEUES_ENABLED` | `false` | Exports/jobs run inline instead of queued |
| `ERROR_TRACKING_ENABLED` | `false` | Sentry forwarding off; own error store still records |
| `SENTRY_DSN` | — | As above |
| `GROQ_API_KEY` / `OPENAI_API_KEY` | — | AI narratives omitted; all analysis stays deterministic |

Every dependency degrades rather than failing: absent credentials remove
enrichment, never core function.

Auto-fix (§10b) is **not** env-configured — it is a per-shop owner setting at
`settingsJson.autoFix.enabled`, defaulting to on, changed via
`PATCH /api/support/auto-fix`. It belongs to the shopkeeper, not the operator.

---

## 13. Tests

```bash
npm run test:diagnostics       # error store + support requests (§1, §7)
npm run test:device-health     # health scoring (§4)
npm run test:sync-diagnostics  # failure explanations (§3)
npm run test:incident-report   # incident composition (§6)
npm run test:audit-timeline    # audit columns, inference, withAudit (§2)
npm run test:report-documents  # PDF/XLSX validity + format routing (§9)
npm run test:remote-support    # consent, scope, allowlist, revoke (§10a);
                               # matching, tiers, cooldown, breaker, opt-out (§10b)
npm run test:event-bus         # event envelope + fault tolerance (§11)
npm run test:event-bus-redis   # real RESP2 socket: the XADD actually sent (§11)
```

`test:event-bus-redis` needs no Redis server and no extra dependency —
`tests/helpers/` contains a minimal RESP2 server, so the real ioredis client
publishes over a real socket and the exact wire command is asserted.
