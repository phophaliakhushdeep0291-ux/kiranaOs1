# Assistant task coverage — 12 October 2026

The assistant is not an autonomous operator for every KiranaOS task. It has nine guarded change tools, grounded read tools, reviewed clarification questions, and a directory covering the shop's current screens. A workflow button is a manual handoff, not execution or form completion. Platform administration is deliberately outside the shop assistant.

## Changes the assistant can propose and execute

Every change requires the user to approve a displayed plan. Existing permissions, entitlements and service validation still apply; confirmation is single-use. Price, pack and stock changes additionally require the owner's PIN. A product's opening price/stock also requires that PIN.

| Task | Execution | Main limits |
| --- | --- | --- |
| Create simple product | Local product service, audit and sync outbox | Owner/manager, product entitlement, explicit name/unit/prices/stock/tax; medicine creation uses its form |
| Add or price a pack size | Existing server product service | Owner PIN; valid product, packaging and unit rules |
| Add bill items | Current cart or staged review | Does not settle the bill or collect payment |
| Create customer | Existing server customer service | Existing customer validation |
| Record credit repayment | Existing server credit service | Records payment; does not transfer money |
| Update product price | Existing server product service | Owner PIN; product and amount validation |
| Correct counted stock | Existing server stock service | Owner PIN; not a substitute for receiving a purchase |
| Create supplier | Local supplier service, audit and sync outbox | Name required; duplicate name/phone checks; current supplier form accepts 10-digit phone numbers; GST/opening balance use the form |
| Record one-off expense | Local expense service and sync outbox | Explicit title, amount, category, method, paid/pending status and date; maximum two decimal places; current counter branch; no money transfer |

“What can you do?” reads the permitted tool registry without a model request on an initial turn. Roles, features and business type constrain the list. Pharmacy shops are not offered simple product creation. Read-only users are not offered changes.

Supplier, expense and product deliveries store an action receipt in the same transaction as the entity/outbox writes. Replayed or concurrent delivery of the same confirmed action cannot duplicate the local record. A local save is shown as pending sync, not server acceptance. The assistant still needs its server/model connection to interpret broad requests; offline-first saving is not an offline language model.

Conversation memory is isolated by login, shop, user, role, counter branch, shop type and UI context. Branch switching cannot carry an old expense proposal into the new branch. Main-panel memory survives closing/reopening within the same tab, while logout clears it and inactivity expires it. Private PIN input is not retained.

## Work that still needs a screen

Checkout, returns/refunds, purchase receiving, supplier settlement, stock transfers, tax configuration, staff administration, integrations, backups and trade-specific changes are not automated by the assistant. The directory offers reviewed internal IDs only; the frontend resolves them through a separate allowlist and current role checks. Normal destination feature and business-profile gates remain in force. Restaurant generic received-orders handoffs are withheld; restaurant table workflows have their own destination.

Dynamic bill/customer/product/finding details use their parent list so the user chooses a real record. The return alias maps to the same return form. Coverage tests fail if a protected shop route or a trade route is added without a handoff. This proves screen coverage, not automation of every action in a screen.

| Workflow | Destination | Additional availability |
| --- | --- | --- |
| Dashboard | `/dashboard` | Signed-in shop user |
| Billing and checkout | `/billing` | not read-only |
| Import an order | `/import-order` | not read-only |
| Returns and refunds | `/returns/new` | not read-only |
| Bill history, receipts and cancellation | `/bills` | Signed-in shop user |
| Received orders | `/orders-received` | Signed-in shop user |
| Sales overview | `/sales-overview` | Signed-in shop user |
| Products and product details | `/products` | Signed-in shop user |
| Product categories | `/categories` | Signed-in shop user |
| Customers and accounts | `/customers` | Signed-in shop user |
| Credit balances and repayments | `/udhar` | Signed-in shop user |
| Receive stock | `/inventory/stock-in` | not read-only |
| Stock removal and wastage | `/inventory/stock-out` | not read-only |
| Stock corrections | `/inventory/adjustments` | not read-only |
| Transfer stock between branches | `/inventory/stock-transfers` | multi_store, not read-only |
| Physical stock counts | `/inventory/stock-counts` | stock_adjustment, not read-only |
| Batches and expiry | `/inventory/batches` | batch_expiry, BATCH_TRACKING |
| Inventory | `/inventory` | Signed-in shop user |
| Purchase bills and receiving | `/purchase-bills` | not read-only |
| Suppliers and settlements | `/suppliers` | not read-only |
| Expenses | `/expenses` | not read-only |
| Offers and discounts | `/offers` | dynamic_customer_pricing |
| Loyalty programme | `/loyalty` | loyalty_program |
| Gift cards | `/gift-cards` | loyalty_program |
| Business reports and exports | `/reports` | Signed-in shop user |
| Channel settlements | `/channel-settlements` | channel_settlement, view_profit |
| Accounting and Tally | `/accounting` | view_profit |
| Money statement | `/money-statement` | Signed-in shop user |
| Daily closing | `/daily-closing` | Signed-in shop user |
| Shop setup | `/settings/setup` | not read-only |
| Settings | `/settings` | Signed-in shop user |
| Store profile and locale | `/settings/store-profile` | not read-only |
| Enabled modules | `/settings/modules` | not read-only |
| Printer setup | `/settings/printer` | Signed-in shop user |
| Billing settings | `/settings/billing` | not read-only |
| Staff settings | `/settings/staff` | staff_login, manage_staff |
| Device settings | `/settings/devices` | Signed-in shop user |
| Sync settings | `/settings/sync` | Signed-in shop user |
| UAE pilot setup | `/settings/uae-pilot` | Signed-in shop user |
| Tax settings | `/settings/taxes` | not read-only |
| Security and PIN settings | `/settings/security` | Signed-in shop user |
| Notifications | `/settings/notifications` | not read-only |
| Integrations | `/settings/integrations` | api_webhook_later, change_settings |
| Backup, export and advanced settings | `/settings/advanced` | not read-only |
| Subscription plans | `/plans` | Signed-in shop user |
| Subscription management | `/subscription` | Signed-in shop user |
| Connected devices | `/devices` | Signed-in shop user |
| Help and support | `/help` | Signed-in shop user |
| Activity insights | `/activity-insights` | view_profit |
| Staff management | `/staff` | staff_login, manage_staff |
| Audit history | `/audit-logs` | audit_logs |
| Assurance findings | `/assurance/findings` | Signed-in shop user |
| Assurance evidence | `/assurance/evidence` | Signed-in shop user |
| Assurance review queue | `/assurance/review-queue` | Signed-in shop user |
| Assurance runs | `/assurance/runs` | Signed-in shop user |
| Assurance rules | `/assurance/rules` | Signed-in shop user |
| Assurance report | `/assurance/report` | Signed-in shop user |
| Assurance cases | `/assurance/cases` | Signed-in shop user |
| Assurance dashboard | `/assurance` | Signed-in shop user |
| Restore deleted records | `/recycle-bin` | not read-only |
| Smart tools | `/smart-tools` | Signed-in shop user |
| Recovery mode | `/recovery-mode` | Signed-in shop user |
| Pending sync and conflicts | `/sync-status` | Signed-in shop user |
| Restaurant tables | `/tables` | restaurant, restaurant_tables |
| Kitchen tickets and status | `/kitchen` | restaurant, restaurant_kot |
| Restaurant menu | `/menu` | restaurant, restaurant_menu |
| Recipes and kitchen stock | `/kitchen-stock` | restaurant, restaurant_recipe_inventory |
| Table reservations | `/reservations` | restaurant, restaurant_tables |
| Prescriptions and dispensing | `/prescriptions` | pharmacy, prescription_tracking |
| Clothing rentals | `/rentals` | clothing, clothing_rentals |
| Serial numbers and warranties | `/serial-units` | electronics, serial_imei_tracking |
| Vehicle fitment | `/fitment` | auto_parts, vehicle_fitment |
| Footwear sizes | `/size-runs` | footwear, footwear_size_runs |
| School book lists | `/book-lists` | stationery, academic_book_lists |
| Furniture orders | `/orders` | furniture, furniture_order_book |
| Cosmetics testers | `/testers` | cosmetics, tester_stock |
| Manufacturing operations | `/manufacturing` | manufacturing |

## Validation and remaining acceptance work

- Backend production checks and the complete AI safety suite pass, including operating-task argument validation, dates/amounts, clarification blocking, confirmation, single-use delivery, tenant isolation, role/feature/trade availability, grounding and red-team regressions.
- Frontend tests exercise atomic receipts, rollback, replay/concurrency, malformed payload refusal, duplicate suppliers, branch memory isolation, workflow allowlists and complete route coverage. The full production gate includes TypeScript, English/Hindi key/placeholder checks, build, bundle/offline checks and the full unit suite.
- A browser fixture exercised the real Assistant UI, IndexedDB and existing local save functions with a scripted API and synthetic shop. It asked for expense payment status, confirmed an expense of 125.75, confirmed a supplier using “haan kar do”, and stored one CREATE_EXPENSE and one CREATE_SUPPLIER operation. The expense retained fixture-branch-one and both records remained pending_sync. A refund request explicitly stayed unfinished and its button navigated to /returns/new without creating a refund.
- The browser fixture does not establish live model understanding or microphone accuracy. Run acceptance tests with the configured provider and intended devices, including Hindi/Hinglish, noisy speech, corrections, uncertain dates, duplicate names and weak connectivity. Arbitrary wording/accent/language accuracy is not guaranteed.
- More direct writers require their own domain validation and recovery tests before they can be claimed as automated. This change does not merge or deploy the branch.

Per-shop assistant context, examples and role/feature filtering are documented in [Assistant abilities by shop type](AI-SHOP-TYPE-CAPABILITIES-2026-10-12.md). Specialist reads do not add specialist write automation.
