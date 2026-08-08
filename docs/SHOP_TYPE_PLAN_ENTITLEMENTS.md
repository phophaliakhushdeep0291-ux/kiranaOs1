# Shop-type plan entitlements

This matrix applies to new subscriptions and explicit plan changes. It follows one product rule: Starter must run the owner's counter safely for that trade; Growth adds staff control, operational depth and expansion workflows; Business adds multi-counter and multi-store scale.

All Starter plans include offline billing, products, stock, purchases, suppliers, customer credit and payment history, PDF/WhatsApp bill sharing, 30-day reports, two-device sync, backup and recovery. All Growth plans add up to five devices and five staff, roles, advanced pricing, profit/payment/monthly reports, CSV workflows, audit logs and priority support. Business adds multi-counter, multi-store, higher limits, GST/Tally workflows, yearly analytics and premium support.

| Shop type | Starter: counter essentials | Growth: operational extras |
| --- | --- | --- |
| Kirana / general store | Loose-item and pack billing, udhar, split payment, daily closing, batch and expiry | Advanced inventory, staff control, customer/quantity pricing and monthly profit reports |
| Clothing / fashion | Size/colour variants, exchanges, ordinary stock and billing | Rentals, loyalty, staff roles and advanced pricing |
| Footwear / shoes | UK/US/EU size runs, pair stock, size-aware selling and exchanges | Loyalty, staff roles, advanced pricing and monthly reporting |
| Auto parts / hardware | Vehicle fitment, alternative-part search, part-number stock and quotations | Advanced inventory, wholesale pricing, staff controls and audit logs |
| Electronics / mobiles | IMEI/serial register, warranty-linked unit history, returns and service history | Repair/open-box operations, advanced inventory, staff controls and profit reports |
| Pharmacy / medical | Prescription register, batch/expiry and medicine stock control | Advanced inventory, staff roles and deeper purchase/payment/profit reports |
| Stationery / books | ISBN-ready catalog, loose stationery and academic book lists opened into billing | Bulk/customer pricing, staff roles, CSV workflows and monthly reports |
| Furniture / home | Quotes, custom orders, advances, reservations and delivery tracking | Advanced inventory, staff roles, customer pricing, audit and profit reports |
| Cosmetics / beauty | Shade variants, batch/expiry and tester-stock cost control | Loyalty, customer pricing, staff accountability and monthly reports |
| Restaurant / cafe | Menu, tables, KOT/kitchen display, split billing and perishable batch/expiry | Recipe ingredient stock, kitchen-stock control, staff roles and advanced reports |
| Other / custom | General billing, inventory, purchases, suppliers, credit and reports | Staff roles, advanced pricing, CSV workflows, audit logs and monthly reports |

Vertical routes and their APIs use the same entitlement keys. A UI lock therefore cannot be bypassed by calling the server directly. New entitlement snapshots carry `shop_type_entitlements_v1`; subscriptions created before that marker are explicitly grandfathered for vertical screens they could already use. Their stored generic plan features and prices remain unchanged.

Changing the shop type updates the catalog comparison immediately, but it does not rewrite an active subscription snapshot. The new shop-type entitlements take effect only on a new subscription or an explicit plan change.
