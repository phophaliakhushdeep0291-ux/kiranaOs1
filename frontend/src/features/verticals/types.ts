import type { LucideIcon } from "lucide-react";
import type { BusinessType } from "@/features/core/settings/business-type-store";
// The capability vocabulary is platform-wide and lives in core, because core
// screens are the ones that ask. A pack only declares which ones it holds.
import type { Capability } from "@/features/core/settings/capabilities";
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
export type VerticalPageId =
  | "clothing/rentals"
  | "auto-parts/fitment"
  | "cosmetics/testers"
  | "electronics/units"
  | "footwear/size-runs"
  | "furniture/orders"
  | "pharmacy/prescriptions"
  | "stationery/book-lists"
  | "restaurant/tables"
  | "restaurant/kitchen"
  | "restaurant/menu"
  | "restaurant/kitchen-stock";

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

export type { Capability };
