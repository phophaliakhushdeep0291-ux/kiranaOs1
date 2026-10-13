# Assistant execution coverage — 13 October 2026

KiranaOS now has **17 guarded change tools**, with voice/text input, reviewed clarification questions and server-grounded replies. This is assisted task execution, not unattended operation of every screen. The current registry, role, subscription and shop type determine what a particular login can use.

## Purchasing through conversation

The assistant can read the current counter's recent purchase orders, order lines and reorder suggestions. An owner or admin with purchase access can then:

1. Create a **draft purchase order** for existing, synced suppliers and products. Quantities, base units, rate units and expected prices are explicit. The preview resolves real names, the branch and the total through the same calculation used when committing the order.
2. Mark an existing draft as sent, with owner PIN. This records a status only; it sends no email or WhatsApp message.
3. Receive goods against a sent order, including partial receipts. The user supplies actual quantities/rates, the amount paid (including explicit zero), payment method if paid, and whether cost should update. Batch/expiry and variance details are requested when needed. Stock, purchase history, accounting, audit and integration events follow the existing purchasing service. No money transfer is performed.
4. Cancel the unreceived remainder with a reason and owner PIN. Prior receipts/payments remain intact.

Examples: “Draft an order for 10 kg of Sugar from North Foods at 38 per kg.” Then, after confirmation: “Mark that order as sent.” Later: “Receive 4 kg against that order at 38 per kg, 50 paid in cash, and keep the existing cost.” Ask for order details if the reference is ambiguous.

Purchase proposals support up to ten lines and two decimal places. Per-pack inventory uses Stock In because the existing purchase-order format cannot identify a pack. Unsynced local products/suppliers must sync before a server purchase order can reference them. Dependent creation/receiving is staged across separate reviewed turns; the assistant never invents IDs for uncommitted records.

## Supplier payments and branch stock

Owners/admins can read the current branch's unpaid purchase rows and record a payment **already made**, with its actual date, method, reference and explicit amount. The preview identifies the supplier, invoice/product row and before/after due. Each row can represent only part of a multi-product invoice, so ambiguous invoice payments require clarification. Owner PIN is required. No money is sent and future/invalid dates are refused.

The assistant and offline sync share one supplier-payment transaction. It re-reads and checks the current balance, rejects inconsistent or overpaid bills, updates both amount and integer-money shadows, and appends the financial ledger/audit together. Stable keys reject changed-payload reuse and prevent duplicate ledger entries. A balance or supplier change after approval requires a fresh preview.

For branches, the assistant reads active locations, branch stock and transfers, then can dispatch a shipment, record a partial/full arrival at the destination, or cancel the undelivered remainder once the user confirms the goods are back at source. Dispatch does not mark goods received. Both locations' permissions are checked, the active counter must match the source/destination for the operation, and owner PIN is required. The shared services revalidate reviewed state inside retrying serializable transactions.

Supported dispatch: up to ten distinct pooled, non-batch product lines with explicit base units and two-decimal quantities, between unregistered locations. Tax/document review, counted sizes, batches and instant moves retain the dedicated Stock transfers form. Receiving/cancellation also keep sizes and batch allocations in that form. This is not automatic physical stock verification or transport booking.

## Execution and recovery

- Each result names the step and reports completed, prepared for the device, failed, uncertain or not started. New purchase results include order/receipt references and totals.
- An error stops later server steps. Completed earlier steps are **not rolled back**; their results remain visible and auditable.
- Invalid/incomplete write proposals suppress the whole proposed plan. Mixed device/server plans request sequencing rather than allowing server changes to overtake local delivery.
- New plans are bound server-side to the proposing user, role, device and counter branch, and expire after 30 minutes. Existing role, feature, business-type and owner-PIN checks remain in place at confirmation.
- Reviewed purchasing data is fingerprinted and checked again inside the committing transaction. Existing order versions are claimed with a compare-and-set before mutation. Changed supplier, unit, branch or order information requires a fresh preview.
- A lost response triggers a **read-only result lookup**. It never repeats a handler or resends cart items. A prepared client action is explicitly not proof of a local save; check the affected record and Sync status when delivery is uncertain.
- Stock correction now respects the current counter branch and inventory assignment, requires the same stock-adjustment entitlement as the manual route, validates nonnegative quantities, and uses a stable action idempotency key.

## Boundaries

Still manual: checkout/payment collection, returns/refunds, direct purchases without a purchase order, supplier payment reversals, complex stock transfers/count workflows, tax/staff/security administration, integration setup, backups, and most trade-specific writes (restaurant tables/kitchen, pharmacy prescriptions, rentals, manufacturing and similar). The reviewed screen handoffs remain available. “What can you do?” lists actual permitted actions.

The language model and cloud speech recognition need connectivity and provider configuration. These server purchasing, supplier-payment and stock-transfer actions require connectivity. Existing offline-first product/supplier/expense saves continue through the local outbox. This is not an offline language model or an always-running background operator.

Action previews/results keep canonical wording, while conversational replies can use the selected assistant language. Live provider interpretation and real microphone accuracy are separate from scripted tool-execution tests.

## Verification

The isolated purchasing test covers no mutation during planning, correct names/units/totals, invalid dates/precision, required inputs, role/feature/branch denial, owner PIN, partial receipt accounting, variance and batch guards, duplicate confirmation, stale previews, stop-on-failure, expired plans, mixed-target sequencing and read-only recovery. Existing packaged-rate purchasing regressions ensure shared calculation behavior remains compatible. Frontend tests distinguish actual server receipts from device preparation and ensure recovery only reads status.


Additional verification: the settlement/transfer regression executes payment → dispatch → partial receipt → returned remainder against an isolated database. It covers exact remaining dues, stable-key replay, scope/feature/PIN restrictions, invalid dates, unit mismatches, overpayment/overreceipt, unsupported packaging, changed approval state and stock conservation. The 99 selected sync, retail-operations and RBAC HTTP tests pass, including required-audit rollback and existing batch/GST transfer flows. A synthetic browser fixture verifies the real assistant's review/PIN and read-only lost-response recovery; it is not a live model or microphone test.
