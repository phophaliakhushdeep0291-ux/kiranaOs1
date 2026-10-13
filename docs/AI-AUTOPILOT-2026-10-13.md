# Assistant execution coverage — 13 October 2026

KiranaOS now has **13 guarded change tools**, up from nine, with voice/text input, reviewed clarification questions and server-grounded replies. This is assisted task execution, not unattended operation of every screen. The current registry, role, subscription and shop type determine what a particular login can use.

## Purchasing through conversation

The assistant can read the current counter's recent purchase orders, order lines and reorder suggestions. An owner or admin with purchase access can then:

1. Create a **draft purchase order** for existing, synced suppliers and products. Quantities, base units, rate units and expected prices are explicit. The preview resolves real names, the branch and the total through the same calculation used when committing the order.
2. Mark an existing draft as sent, with owner PIN. This records a status only; it sends no email or WhatsApp message.
3. Receive goods against a sent order, including partial receipts. The user supplies actual quantities/rates, the amount paid (including explicit zero), payment method if paid, and whether cost should update. Batch/expiry and variance details are requested when needed. Stock, purchase history, accounting, audit and integration events follow the existing purchasing service. No money transfer is performed.
4. Cancel the unreceived remainder with a reason and owner PIN. Prior receipts/payments remain intact.

Examples: “Draft an order for 10 kg of Sugar from North Foods at 38 per kg.” Then, after confirmation: “Mark that order as sent.” Later: “Receive 4 kg against that order at 38 per kg, 50 paid in cash, and keep the existing cost.” Ask for order details if the reference is ambiguous.

Purchase proposals support up to ten lines and two decimal places. Per-pack inventory uses Stock In because the existing purchase-order format cannot identify a pack. Unsynced local products/suppliers must sync before a server purchase order can reference them. Dependent creation/receiving is staged across separate reviewed turns; the assistant never invents IDs for uncommitted records.

## Execution and recovery

- Each result names the step and reports completed, prepared for the device, failed, uncertain or not started. New purchase results include order/receipt references and totals.
- An error stops later server steps. Completed earlier steps are **not rolled back**; their results remain visible and auditable.
- Invalid/incomplete write proposals suppress the whole proposed plan. Mixed device/server plans request sequencing rather than allowing server changes to overtake local delivery.
- New plans are bound server-side to the proposing user, role, device and counter branch, and expire after 30 minutes. Existing role, feature, business-type and owner-PIN checks remain in place at confirmation.
- Reviewed purchasing data is fingerprinted and checked again inside the committing transaction. Existing order versions are claimed with a compare-and-set before mutation. Changed supplier, unit, branch or order information requires a fresh preview.
- A lost response triggers a **read-only result lookup**. It never repeats a handler or resends cart items. A prepared client action is explicitly not proof of a local save; check the affected record and Sync status when delivery is uncertain.
- Stock correction now respects the current counter branch and inventory assignment, requires the same stock-adjustment entitlement as the manual route, validates nonnegative quantities, and uses a stable action idempotency key.

## Boundaries

Still manual: checkout/payment collection, returns/refunds, direct purchases without a purchase order, supplier settlement, stock transfers/count workflows, tax/staff/security administration, integration setup, backups, and most trade-specific writes (restaurant tables/kitchen, pharmacy prescriptions, rentals, manufacturing and similar). The reviewed screen handoffs remain available. “What can you do?” lists actual permitted actions.

The language model and cloud speech recognition need connectivity and provider configuration. These server purchasing actions require connectivity. Existing offline-first product/supplier/expense saves continue through the local outbox. This is not an offline language model or an always-running background operator.

Action previews/results keep canonical wording, while conversational replies can use the selected assistant language. Live provider interpretation and real microphone accuracy are separate from scripted tool-execution tests.

## Verification

The isolated purchasing test covers no mutation during planning, correct names/units/totals, invalid dates/precision, required inputs, role/feature/branch denial, owner PIN, partial receipt accounting, variance and batch guards, duplicate confirmation, stale previews, stop-on-failure, expired plans, mixed-target sequencing and read-only recovery. Existing packaged-rate purchasing regressions ensure shared calculation behavior remains compatible. Frontend tests distinguish actual server receipts from device preparation and ensure recovery only reads status.
