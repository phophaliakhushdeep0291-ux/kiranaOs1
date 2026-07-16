# POS Market Comparison

Status: Research framework; claims require dated source evidence  
Last updated: 2026-07-16

## Purpose

This document guides product decisions without pretending that remembered competitor features are current facts. Before pricing or positioning decisions, validate each external claim against the vendor's current plan page, help center and a hands-on trial, recording the date and URL.

## Comparison set

The relevant alternatives for an Indian kirana are Vyapar, myBillBook, Khatabook, GoFrugal, Marg ERP, Zoho POS/Books/Inventory combinations, and manual billing plus WhatsApp/UPI. Shopify POS is a useful interaction benchmark but is not the primary product or price target.

## Evidence matrix

Use `Yes`, `Partial`, `No`, or `Unverified`; never infer a feature from marketing language.

| Capability | KiranaOS evidence today | Vyapar | myBillBook | Khatabook | GoFrugal | Marg ERP | Acceptance target |
|---|---|---|---|---|---|---|---|
| Offline billing | Local-first/outbox tests | Unverified | Unverified | Unverified | Unverified | Unverified | Bill and print through 30-minute outage |
| GST invoice/returns support | GST/compliance tests | Unverified | Unverified | Unverified | Unverified | Unverified | Invoice/report totals reconcile |
| Udhar ledger | Ledger/accounting tests | Unverified | Unverified | Unverified | Unverified | Unverified | Offline payments and reversals safe |
| Fast barcode billing | Product/billing foundation | Unverified | Unverified | Unverified | Unverified | Unverified | Median bill time measured in beta |
| Split/UPI/card payments | Retail payment foundation | Unverified | Unverified | Unverified | Unverified | Unverified | Exact tender reconciliation |
| Purchase-to-stock lifecycle | PO/receipt migrations | Unverified | Unverified | Unverified | Unverified | Unverified | Receipt updates stock once |
| Supplier ledger | Partial; certify | Unverified | Unverified | Unverified | Unverified | Unverified | Reconciled supplier due |
| Batch/expiry and WAC | Migrations/scripts | Unverified | Unverified | Unverified | Unverified | Unverified | Audit-grade movement history |
| Multi-device conflict safety | Sync integration tests | Unverified | Unverified | Unverified | Unverified | Unverified | No duplicates under concurrency |
| Hardware breadth | Bridge; certification pending | Unverified | Unverified | Unverified | Unverified | Unverified | Published per-model matrix |
| Customer order link | Public catalog/order tests | Unverified | Unverified | Unverified | Unverified | Unverified | Order converts to one bill |
| Owner two-minute dashboard | Reports foundation | Unverified | Unverified | Unverified | Unverified | Unverified | Daily close and exceptions first |
| Data export/exit | Export tests | Unverified | Unverified | Unverified | Unverified | Unverified | Owner can export core records |

## Positioning hypothesis

KiranaOS should win on trust and workflow, not breadth of checkboxes:

- Safer offline billing and multi-device reconciliation.
- A purchase, stock and supplier trail strong enough for daily operations.
- Phone-first cashier flows that remain fast on low-cost hardware.
- Plain-language sync, print and payment recovery.
- Kirana-scale online ordering through a link/QR and WhatsApp, without ecommerce administration overhead.

These are hypotheses until beta-shop measurements support them.

## Competitive research protocol

For every candidate product:

1. Record edition, plan, platform, device and research date.
2. Create the same ten-product catalog and two customers.
3. Run the same flows: cash bill, udhar bill, return, offline bill, purchase receipt, stock correction, daily close, export and restore attempt.
4. Capture taps, elapsed time, failure behavior, hidden limits and support answer.
5. Separate advertised capability from observed capability.
6. Add evidence links/screenshots and an owner quote; remove stale findings after 90 days.

## Scorecard

Weight what determines shop trust rather than feature count.

| Dimension | Weight |
|---|---:|
| Billing speed and learnability | 20% |
| Offline/data-loss safety | 20% |
| Inventory and purchase correctness | 15% |
| Udhar and payment reconciliation | 10% |
| GST/compliance fitness | 10% |
| Mobile quality | 10% |
| Hardware reliability | 5% |
| Reporting clarity | 5% |
| Price, support and data portability | 5% |

## Research backlog

- Run hands-on trials for the comparison set using the protocol above.
- Interview 3-5 shops about current tools, switching triggers and failure stories.
- Establish target segment: single-store general kirana first; document exclusions.
- Validate pricing only after total device, support, GST and hardware costs are known.
