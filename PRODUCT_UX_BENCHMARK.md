# POS UX benchmark and delivery status

Last reviewed: 11 August 2026

## Current position

Artha now follows the strongest small-business POS pattern: a fast selling surface, a compact owner overview, and deeper operational tools disclosed only when needed. Its clearest advantage is India-first offline billing, ledger, GST, and multi-vertical support. Its remaining disadvantage versus mature platforms is consistency: a few operational pages are still unusually large and some advanced workflows use bespoke states instead of the shared UI system.

| Workflow | Artha status | Market reference | Next measurable target |
| --- | --- | --- | --- |
| Checkout | Primary payment choices are visible; secondary methods are disclosed; receipt actions appear after saving | Shopify emphasizes a configurable fast POS surface; Square emphasizes few-tap refunds and checkout | New cashier completes cash and UPI sales without help in under 45 seconds |
| Owner overview | Four primary KPIs, useful zero states, comparisons, and detailed analysis disclosure | Zoho surfaces sales, inventory, top items, and order status; Square prioritizes real-time sales and customer insights | Owner identifies sales, profit, dues, and stock risk in under 20 seconds |
| Customers and credit | Four primary account metrics with collection and reminder actions | Shopify connects customer profile, order history, total spend, and preferences | Find debtor and record collection in under 30 seconds |
| Purchases | Explicit Order → Receive → Record bill → Settle due lifecycle; planning is secondary | Zoho models a purchase-order lifecycle; Square combines vendors, purchase orders, receiving, and inventory history | Receive a planned order and expose supplier due in under 60 seconds |
| Inventory | Real-time local stock, transfers, counts, alerts, and shared loading/error/empty states | Square and Shopify highlight multi-location real-time stock, transfers, history, and alerts | Every inventory mutation shows source, destination, reason, and recoverable result |
| Navigation | Role-focused primary navigation with secondary tools grouped | Shopify supports a configurable POS home; mature back offices separate daily work from administration | Daily cashier tasks remain within one navigation level |

## Implemented from the audit

- Simplified role-focused navigation and grouped secondary owner tools.
- Removed redundant healthy sync messaging; exceptions remain visible.
- Simplified billing payment selection and post-sale receipt actions.
- Reduced Sales Overview and Customers to decision-focused primary metrics.
- Added actionable comparison and zero-data copy.
- Added a visible purchase lifecycle and collapsed planning details.
- Expanded route preloading to Billing, Customers, Udhar, Inventory, Purchases, and Sales Overview.
- Standardized transfer loading, failure/retry, and empty states.
- Extracted the purchase workflow from the large purchase page as the first structural boundary.

## Engineering follow-through

Large pages should be reduced incrementally, with one tested boundary per change. Recommended next boundaries are dashboard vertical layouts, billing orchestration hooks, customer dialogs, purchase dialogs, and sync diagnostics. A line-count reduction alone is not success; each extraction must reduce rerenders or isolate a workflow with focused tests.

## Official references

- [Zoho POS dashboards](https://www.zoho.com/en-in/pos/resources/help/dashboards.html)
- [Zoho POS features](https://www.zoho.com/en-in/pos/features/)
- [Zoho purchase-order overview](https://www.zoho.com/us/inventory/help/purchase-orders/purchase-orders-overview.html)
- [Square POS analytics](https://squareup.com/us/en/point-of-sale/features/dashboard/analytics)
- [Square inventory management](https://squareup.com/us/en/point-of-sale/features/inventory-management)
- [Shopify retail POS](https://www.shopify.com/pos/retail-pos)
- [Shopify multi-store POS](https://www.shopify.com/pos/multi-store-pos)
