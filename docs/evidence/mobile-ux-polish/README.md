# Mobile UX polish — 7 September 2026

This is local frontend verification, not production release certification. The repository's [release gate](../../../RELEASE_GATE.md) still records NO-GO because candidate, external and manual evidence is incomplete.

## Delivered

- A calmer mobile sales summary, an emphasized Sell destination, more compact shop-health cards, and recent bills moved ahead of longer reports and guidance.
- Searchable More navigation, including nested stock tools, an empty-result recovery action and a selected state on secondary routes. Existing role, module and business-profile filtering stays in effect.
- Customer search above the summary cards, with submit scrolling to the filtered list; Collect due opens the customers-with-balance filter directly.
- Collapsible phone guidance across pages using TradeFocusStrip, with the full guidance and links retained on desktop.
- Useful billing empty states: open the catalog, or clear a search/category filter. Empty categories no longer claim that the entire catalog is empty.
- Honest dashboard states: unsold inventory is no longer presented as top-selling products, no-sales/no-dues states have explicit copy, and period comparisons use the appropriate label.
- English/Hindi text for the new actions. Onboarding describes recording a real sale instead of promising a practice transaction.
- Larger small-phone header targets and a readable, touch-sized demo cleanup button; negative shop-health changes use a darker red for contrast.

## Verification

The frontend production gate passed: TypeScript, 5,767 English/Hindi key comparisons, 2,320 tests passed with one intentional skip, Vite production build, bundle budgets and production-app checks. After the final onboarding wording adjustment, translation checks, build and security checks were repeated and passed.

[report.json](report.json) contains 22 settled mobile/tablet audits:

| Coverage | Viewports |
| --- | --- |
| Home, Billing, Customers, Inventory | 375×667, 390×844, 430×932, 768×1024 |
| Home with explicitly seeded local demo data | 375×667, 390×844, 430×932, 768×1024 |
| Hindi Home | 390×844 |
| Small-phone Home | 360×740 |

Every recorded audit has zero document overflow, runtime errors, detected structural accessibility issues, axe WCAG violations and visible active controls below 44×44 CSS pixels. These are automated checks, not a claim of complete accessibility certification. Captures were collected across empty and sample-data states; demo data can be reconciled by the app during subsequent navigation.

Live interaction checks also passed for the due-customer SPA transition, guidance expand/collapse, nested menu filtering, empty menu recovery, the billing catalog action, customer-search submit/scroll, billing-search reset and drawer accessibility. The 1440×1000 desktop dashboard passed a separate geometry and visual review. No customer message, payment-provider transaction, deployment or physical print was performed.

The screenshots are included alongside the report; [checksums.json](checksums.json) records their hashes. Temporary CDP harnesses and the isolated browser profile are retained locally under ignored `qa-artifacts/mobile-ux-polish/`. Existing reusable broad coverage is available through `pnpm run qa:mobile-core-matrix` in `frontend`.

## What this means for selling

The frontend is more usable for a product demo and merchant review. This pass does not close the existing release requirements for the exact deployable candidate, production PostgreSQL/backup-and-restore evidence, operating-system offline checks, or real printer verification. Complete the outstanding items in RELEASE_GATE.md before representing the product as production-certified. The changes are local and have not been deployed.
