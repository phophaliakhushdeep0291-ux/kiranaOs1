import type { LucideIcon } from "lucide-react";
import type { BusinessType } from "@/features/core/settings/business-type-store";
import type { FeatureName } from "@/features/core/subscription/plans";

/**
 * A vertical pack is everything that belongs to one trade and to no other.
 *
 * The rule that keeps shops from interfering with each other: a pack may build
 * on `features/core`, but `features/core` may never import a pack, and no pack
 * may import another pack. `src/tests/vertical-boundaries.test.ts` fails the
 * build if that is broken, so the isolation is enforced rather than agreed.
 *
 * Only the active shop's pack is mounted — its routes, its sidebar entries, its
 * mobile drawer entries. A kirana shop cannot reach a clothing route by typing
 * the URL, because for that shop the route was never registered.
 */
/**
 * One id per trade, matching the pack's directory name here and its twin under
 * backend/src/verticals/. This is internal routing identity only — the value
 * persisted on a shop is `BusinessType`, and four of the two differ by name
 * (stationery, furniture, cosmetics, other). Never store a VerticalId.
 */
export type VerticalId =
  | "kirana"
  | "clothing"
  | "footwear"
  | "auto-parts"
  | "electronics"
  | "pharmacy"
  | "stationery-books"
  | "furniture-home"
  | "beauty-cosmetics"
  | "restaurant"
  | "custom";

/**
 * Every screen a pack can mount.
 *
 * A pack names its pages rather than holding `lazy()` itself, and the router
 * owns the actual dynamic imports (`VERTICAL_PAGES` in `app/routes.tsx`). That
 * is a bundling decision, not bureaucracy: the registry is statically reachable
 * from the app entry, so a `lazy()` living here produces a lone small chunk
 * whose only importer is the startup shell — which `experimentalMinChunkSize`
 * then folds *into* the shell, making every kirana shop download the clothing
 * screens. Declared next to the other route imports, a trade's page merges with
 * its lazy siblings and is downloaded only by the shops that have it.
 *
 * `Record<VerticalPageId, ComponentType>` in the router makes the compiler
 * reject a page named here and never wired up.
 */
export type VerticalPageId = "clothing/rentals";

/**
 * What a trade can do, mirroring `CAPABILITIES` in
 * `backend/src/verticals/profile.js`. `vertical-capabilities.test.ts` fails the
 * build if the two lists drift apart.
 *
 * Capabilities, not business types, are what the UI should branch on: a shop
 * asking "do I sell loose?" must not have to know which trades those are, and
 * batch tracking is wanted by pharmacy, kirana and cosmetics alike.
 */
export type Capability =
  // Baseline
  | "BASIC_INVENTORY" | "LOOSE_ITEMS" | "PACK_CONVERSION" | "NEGATIVE_STOCK"
  | "UDHAR" | "SPLIT_PAYMENTS" | "DAILY_CLOSING"
  // Variants
  | "PRODUCT_VARIANTS" | "SIZE_SYSTEMS" | "PAIR_STOCK" | "EXCHANGES" | "ALTERATIONS"
  // Batch / expiry
  | "BATCH_TRACKING" | "EXPIRY_TRACKING" | "SUPPLIER_RETURNS"
  // Serialised goods
  | "SERIAL_TRACKING" | "IMEI_TRACKING" | "WARRANTY_TRACKING" | "REPAIR_TICKETS"
  | "OPEN_BOX_STOCK"
  // Parts & fitment
  | "VEHICLE_FITMENT" | "ALTERNATIVE_PARTS" | "RACK_LOCATIONS" | "WHOLESALE_PRICING"
  // Pharmacy
  | "PRESCRIPTION_TRACKING" | "MEDICINE_SUBSTITUTES"
  // Books & institutional
  | "ISBN_CATALOG" | "ACADEMIC_BOOK_LISTS" | "PRODUCT_BUNDLES" | "INSTITUTIONAL_ORDERS"
  // Order-driven retail
  | "QUOTATIONS" | "SALES_ORDERS" | "CUSTOM_ORDERS" | "ADVANCE_PAYMENTS"
  | "STOCK_RESERVATION" | "DELIVERY_ORDERS" | "INSTALLATION_TRACKING"
  // Beauty
  | "TESTER_STOCK" | "LOYALTY"
  // Restaurant
  | "TABLE_MANAGEMENT" | "KOT" | "KITCHEN_DISPLAY" | "MENU_MODIFIERS"
  | "RECIPE_INVENTORY" | "SPLIT_BILLING" | "TAKEAWAY"
  // Configurable
  | "CUSTOM_FIELDS";

export interface VerticalRoute {
  /** Wouter pattern, e.g. "/rentals" or "/tables/:id". */
  path: string;
  page: VerticalPageId;
  /** Plan gate, composed on top of the vertical gate. */
  featureName?: FeatureName;
}

export interface VerticalNavEntry {
  href: string;
  label: string;
  Icon: LucideIcon;
  /** Sidebar placement: dropped in right after this href. Appended when absent. */
  insertAfter?: string;
  /** Placement in the mobile "More" drawer. Omit to keep the entry desktop-only. */
  mobile?: { group: string; helper: string };
}

export interface VerticalPack {
  id: VerticalId;
  label: string;
  /** Business types served by this pack. Every BusinessType must be claimed exactly once. */
  businessTypes: BusinessType[];
  /**
   * Route prefixes this pack owns, for the "is this path mine?" check that hides
   * another trade's entry points. Declared rather than derived from `routes` so a
   * pack can claim a prefix before the page behind it exists.
   */
  paths: string[];
  routes: VerticalRoute[];
  nav: VerticalNavEntry[];
  /**
   * What this trade can do. Declared on the client rather than only read from
   * the server bootstrap because the POS has to answer "does this shop sell
   * loose?" on first paint and while offline — and because the backend derives
   * these from the business type too, so there is nothing per-shop to fetch.
   */
  capabilities: readonly Capability[];
}
