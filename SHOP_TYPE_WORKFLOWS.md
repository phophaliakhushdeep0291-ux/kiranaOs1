# Shop-Type Workflow Research

Status: Phase 1 implemented  
Research date: 2026-07-31

## Product principle

Changing shop type must change daily work, not only colors or labels. KiranaOS now uses one centralized workflow profile to adapt:

- the four highest-value actions on Dashboard;
- product-name, brand, identifier, and notes prompts;
- units and categories already provided by the business-type definition;
- batch-and-expiry recommendations where lot control matters.

The first release only launches workflows that already have reliable routes and data models. Deeper capabilities such as a true size-colour matrix, unit-level serial ledger, table/KOT state, and delivery scheduling remain explicit follow-up work rather than misleading UI.

## Evidence used

- Shopify documents inventory per size/colour variant and recommends a unique SKU per product variant: https://help.shopify.com/en/manual/products/variants and https://help.shopify.com/en/manual/products/details/sku
- Lightspeed documents serialized inventory linking an exact unit to its sale, customer, return, repair, and warranty status: https://retail-support.lightspeedhq.com/hc/en-us/articles/37022957532443-Selling-products-with-serial-numbers
- CDSCO's Drugs Rules describe retail records that can require drug name, manufacturer, batch number, and expiry information: https://cdsco.gov.in/opencms/resources/UploadCDSCOWeb/2022/drug_rules/Drugs%20Rules%201945_2024%2009.pdf
- Square documents restaurant open tickets, table/seat organization, modifiers, kitchen routing, and split checks: https://squareup.com/help/article/5809-use-predefined-tickets and https://squareup.com/help/us/en/article/8583-manage-seats-in-your-restaurant
- Square documents purchase orders, vendor association, partial receiving, low-stock alerts, and stock counts: https://squareup.com/help/us/en/article/8258-create-purchase-orders-with-square-for-retail and https://squareup.com/us/en/retail/capabilities
- Shopify documents a local-delivery lifecycle from unfulfilled through ready-for-delivery and delivered: https://help.shopify.com/en/manual/fulfillment/fulfilling-orders/local-delivery-fulfillment

## Shop workflow matrix

| Shop type | Daily friction | Phase 1 workflow now | Next specialized capability |
|---|---|---|---|
| Kirana / general | Fast billing, loose versus packed stock, shelf refill, udhar | Fast billing, pack/loose setup, purchases, customer orders | Weighted barcode and suggested replenishment |
| Clothing | Size/colour availability, seasonal stock, exchanges | One SKU per size/colour guidance, stock count, returns, offers | True variant matrix and ageing by size/colour |
| Footwear | Missing sizes, pair counts, exchanges | One SKU per model/size guidance, pair stock count, returns | Size-run replenishment and exchange shortcut |
| Auto parts / hardware | Part-number search, fitment, supplier dependence, party credit | Part-number and compatibility prompts, purchase, godown count, khata | Structured vehicle/machine fitment search |
| Electronics / mobiles | Model confusion, high-value stock, warranty and serial trace | Model/SKU and warranty prompts, frequent count, bill-linked returns | Unit-level serial/IMEI and warranty ledger |
| Pharmacy | Batch, expiry, recall, low stock, regulated records | Batch recommendation, expiry control, purchase, low-stock and accounts | Prescription/schedule controls and mandatory field policy |
| Stationery / books | ISBN/barcode entry, seasonal demand, bulk pricing | ISBN prompts, purchase, stock count, reports | School-list bundles and class/edition filters |
| Furniture / home | Quotation, dimensions, images, advances, fulfilment | Estimate, visual catalogue prompts, customer orders, balance collection | Delivery/installation scheduling and order stages |
| Cosmetics | Shade-level stock, dated products, repeat customers | Shade SKU guidance, batch recommendation, offers, loyalty | Shade matrix and beauty-profile CRM |
| Restaurant / café | Menu speed, open tickets, kitchen accuracy, day closing | New order, menu setup, incoming orders, closing | Tables, open tickets, modifiers, KOT/KDS, split checks |
| Other / custom | Unknown workflow | Reliable billing, product, inventory, and reports baseline | Owner-configurable workflow profile |

## Delivery phases

### Phase 1 — shipped in this change

- Central `SHOP_WORKFLOWS` capability map for all supported shop types.
- Shop-specific Dashboard workflow launcher on mobile and desktop.
- Shop-specific product terminology, examples, identifiers, and notes.
- Batch-and-expiry recommendation and toggle inside the active product form.
- Immediate reactivity when shop type changes in Store Profile.

### Phase 2 — inventory identity

- Apparel/footwear/cosmetics variant matrix with stock per combination.
- Electronics unit serial/IMEI ledger tied to receipt, sale, return, and warranty.
- Auto-parts structured fitment attributes and fast compatibility search.

### Phase 3 — service operations

- Restaurant tables, open tickets, seats, modifiers, KOT/KDS, and split checks.
- Furniture delivery, installation, advance, balance, and completion stages.
- Pharmacy prescription and schedule-policy workflow after legal review.

### Phase 4 — automation

- Shop-specific replenishment suggestions using sell-through and lead time.
- Seasonal stock planning for school, fashion, footwear, and festival demand.
- Exception-first owner alerts and shop-specific reports.

## Acceptance criteria

1. Changing business type updates the workflow launcher without reload.
2. Every action points to an existing protected route.
3. Product entry uses shop-appropriate terminology and examples.
4. Pharmacy and cosmetics visibly recommend batch tracking.
5. No UI claims that unsupported serial, variant, table, or delivery state already exists.
6. Generic retail behavior remains available for `other`.
