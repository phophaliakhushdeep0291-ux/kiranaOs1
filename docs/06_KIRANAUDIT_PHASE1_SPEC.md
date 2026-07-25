# KiranaAudit — Phase-1 Product Spec: The Internal-Audit + Fraud-Detection Wedge

> This is the **wedge product** that lets us enter the market TODAY without touching Section 141 (statutory-auditor eligibility) or Section 144 (independence). Client's existing CA stays untouched; we sell "AI-powered continuous internal audit" as a CFO tool.

## 1. Positioning

- **Not** statutory audit
- **Not** replacement for the CA
- **Yes** "an always-on set of AI audit-quality controls over your books" — think MindBridge Ai + Bharat context
- Target buyer: **CFO** or Founder of ₹10 Cr - ₹500 Cr turnover Indian SME (~500,000 companies)
- Price: ₹15,000 - ₹1,00,000/month per client depending on turnover + module bundle
- 20 paying clients in Year 1 → ₹1.5-2 Cr ARR → validates thesis for Phase-2/3

## 2. Modules (v1)

| Module | What it checks | Data it needs |
|---|---|---|
| **M-A Duplicate Payments** | Same bill/amount/mode paid twice; near-clones across bills within 30 min; idempotency-key collisions; reversed payment still in daily-close | payments, bills, udhar-ledger, snapshots |
| **M-B GSTR-2A Reconciler** | Purchase register vs GSTR-2A: missing filings, ghost invoices, amount mismatches, GSTIN swaps, cross-period late-filings | purchase register export + GSTR-2A JSON (via ClearTax API or Setu) |
| **M-C Cash Discipline** | Sec 40A(3) > ₹10k cash payments; Sec 269SS/T deposit-in-cash violations; weekend/night cash entries; cash payments to related parties | expenses, payments, vendor master |
| **M-D Ghost Vendor Detection** | Vendor bank a/c matches employee bank a/c; vendor PAN never used before this month; vendor address = employee address; new vendor's first invoice > ₹50k | suppliers, purchases, employees (payroll optional) |
| **M-E Round-tripping & Kite** | A→B→A payment loops within 24h; suspicious in-and-out on the same day at close-of-day; large customer refund followed by re-billing | payments, journals |
| **M-F Post-period Modification Watch** | Ledger entries touched after month-end / after CA visit; unusual weekend/holiday modifications | audit log (crucial — needs KiranaOS's existing AuditLog OR client's own DB audit trail) |
| **M-G Continuous Reasonableness Ratios** | GM% deviation vs peer stores; debtor-days drift; inventory turnover anomalies; salary/turnover ratio | full P&L + BS |

**Phase-1 launches with M-A, M-B, M-C, M-D.** M-E/F/G ship in Phase-1.5 (month 6-8).

## 3. Wedge deliverable — the monthly "Audit Pack"

Every month client gets:
1. **Executive summary** (2 pages) — count of findings, ITC at risk, fraud signals, action list
2. **Detailed findings PDF** — one page per finding with reasons + evidence chain
3. **CSV exports** for the client's own team to action
4. **Loom-style video walkthrough** of the top 5 findings (AI-narrated to start; human as clients scale)
5. **Question inbox** — client asks any of the findings by email; we reply within 24h

Delivery via web dashboard + email; no app to install.

## 4. What we fork from KiranaOS (reuse) vs write fresh

| Layer | KiranaOS module | Reuse strategy |
|---|---|---|
| **Auth + RBAC + Sessions + Devices** | `src/modules/{auth,devices,subscription}` | **Fork as-is**. Rename `shopId → clientId`, `staff → reviewer`, add `role: partner|reviewer|analyst|read_only` |
| **Immutable audit log** | `src/modules/audit`, `AuditLog` model | **Fork as-is**. Every AI finding, every human override becomes a row here. Legal requirement. |
| **Idempotent write pattern** | `bills.service.js`, `finance/financial-ledger.service.js` | **Fork pattern, rewrite entity**. Each audit finding gets a deterministic `idempotencyKey = hash(shopId, rule, subjectId, evidenceHash)` so re-running the same detector doesn't duplicate findings |
| **Multi-tenant `shopId` scoping** | every route, every query | **Fork as-is**. Every audit query filters by `clientEngagementId` |
| **Sync outbox** | `src/modules/sync/*` | **Do NOT fork.** Audit is server-side batch. No offline client. |
| **BullMQ + Redis workers** | `src/workers/` | **Fork as-is**. Every detector rule = a job. Nightly at 02:00 IST. |
| **S3 + storage-healthcheck** | `src/lib/objectStorage.js` | **Fork as-is** + add WORM bucket policy for 7-year retention |
| **OpenAI wiring + AiActionLog** | `src/modules/ai/*` | **Fork the wiring**, rewrite the prompts. Prompt is not "help the shopkeeper"; it's "given these financial rows, is there an anomaly per SA 240?" |
| **Prometheus + error-tracking** | `src/lib/{metrics,errorTracking}.js` | Fork as-is |
| **Razorpay** | `src/modules/payment-provider/` | Fork; used for monthly subscription billing to CFO client |
| **Feature-gates + Plan** | `src/modules/feature-gates` | **Fork**. Plans are now Silver/Gold/Platinum by module + client size |
| **PostgreSQL schema** | `prisma/schema.prisma` | **Do NOT fork wholesale**. Only fork: User, Session, Device, Plan, Subscription, AuditLog, ChangeLog, FinancialLedger. Everything else (Bill, Product, Customer, Purchase, Udhar, StockLedger) is REPLACED by audit-domain models. |

Percentage-wise: **~85% of infra code forks, ~15% of domain code**. Total forked code ≈ 8-12k lines out of KiranaOS's ~50k lines.

## 5. Fresh code to write (the audit domain)

| Component | Est. LOC | Priority |
|---|---|---|
| **Client-engagement schema** — Engagement, Client, DataConnector, EvidenceItem, EvidenceGraph, AuditFinding, ReviewSignoff | 800 lines Prisma | P0 |
| **Ingestion connectors** — Tally XML pull, GSTR-2A downloader (via Setu/ClearTax), CSV drop, PDF invoice OCR | 3000-5000 lines | P0 (Tally + GSTR-2A only for MVP) |
| **Rule engine** — RuleRegistry, RuleContext, Finding factory, deterministic idempotency, config-driven thresholds | 1500 lines | P0 |
| **Detector: Duplicate Payments (M-A)** | 400 lines (prototype exists) | P0 ✅ |
| **Detector: GSTR-2A (M-B)** | 500 lines (prototype exists) | P0 ✅ |
| **Detector: Cash Discipline (M-C)** — Sec 40A(3), 269SS/T | 400 lines | P0 |
| **Detector: Ghost Vendors (M-D)** — vendor/employee overlap | 600 lines | P0 |
| **CA reviewer dashboard** (React) | 3000 lines | P0 |
| **Client dashboard** (React) — findings + status + upload | 2500 lines | P0 |
| **Monthly Audit Pack generator** — PDF (via Puppeteer), CSV exports, S3 store, WORM | 800 lines | P0 |
| **AI-narrated video** for finding walkthroughs | Later | P1 |
| **Notification/confirmation email flow** | 400 lines | P0 |
| **Independence firewall middleware** (see doc `07_INDEPENDENCE.md`) | 300 lines | P0 |

**Total fresh code for Phase-1 MVP: ~13-15k lines.** With one senior engineer at 40 productive lines/day, this is **8-10 months solo** or **3-4 months with a small team (2 engineers + 1 CA subject-matter expert)**.

## 6. Timeline (aggressive but realistic)

| Month | Deliverable |
|---|---|
| M1 | Fork KiranaOS infra; set up new repo `kiranaudit-backend`; auth + tenancy running |
| M2 | Client-engagement schema + Tally XML pull + first Duplicate Payments detector against a real client's export |
| M3 | GSTR-2A reconciler + Setu/ClearTax integration + Client dashboard v0 |
| M4 | Cash discipline + Ghost vendor detectors + CA reviewer dashboard v0 |
| M5 | Monthly Audit Pack generator (PDF+CSV) + email delivery + first paying pilot client |
| M6 | 3 paying pilots; iterate rule library based on findings that pilots dispute |
| M7 | Public launch; content marketing; open first 10 paid slots at ₹25k/mo |
| M8-M12 | Scale to 20-30 clients; add M-E/F/G detectors; hire second CA |

## 7. Success metrics

- **Precision of findings** — of every 100 findings we ship, how many does the CA agree with? Target ≥ 80% by month 6, ≥ 90% by month 12
- **True fraud caught per crore of transactions** — target 1-2 real incidents per crore in year 1
- **ITC-at-risk recovered** — total ₹ of ITC we saved clients from losing
- **Time-to-first-finding** for a new client — target < 4 hours after data upload
- **NRR** on subscription — target > 105% by month 12
- **Referral rate** — clients tell their CA → CA becomes a channel partner

## 8. What we DO NOT do in Phase-1

- Do not offer statutory audit (Section 141 forbids)
- Do not prepare books / bookkeeping / accounting for audit clients (Sec 144)
- Do not sign the ITR / GST returns / MCA filings
- Do not talk to tax officers on the client's behalf
- Do not offer legal advice; findings are always "recommend consulting your CA / counsel"

## 9. What Phase-2 + Phase-3 look like (out of scope for this spec)

- **Phase-2 (Year 2):** Partner with 5-10 mid-tier CA firms; they sign under their own registration; we take 30-50% of the engagement fee; captures labelled findings for training
- **Phase-3 (Year 3):** Form the KiranaAudit LLP; recruit CA partners; register with ICAI + Peer Review Board; only then market as "AI-native audit firm"
- **Phase-4 (Year 4+):** Push regulator (ICAI + MCA) toward recognising machine-executed procedures under a new SA-240-A guideline
