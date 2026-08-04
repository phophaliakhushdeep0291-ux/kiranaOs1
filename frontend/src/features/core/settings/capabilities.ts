import { useCallback } from "react";
import { useBusinessTypeKey, getStoredBusinessType, type BusinessType } from "./business-type-store";

/**
 * What a trade can do, mirroring `CAPABILITIES` in
 * `backend/src/verticals/profile.js`.
 *
 * The vocabulary lives in core, not in `features/verticals`, because core
 * screens are the ones that ask the questions — "does this shop sell loose?",
 * "does it track batches?" — and core may never import a vertical. The packs
 * declare which of these they hold; core only ever reads the answer.
 *
 * Branch on a capability, never on the business type. Loose selling belongs to
 * kirana *and* stationery, batch tracking to pharmacy, kirana *and* cosmetics,
 * and those lists change without any screen needing to know.
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

/**
 * Which capabilities a trade holds. The vertical registry installs the real
 * answer at startup (see `components/layout/index.ts`); until it does, a shop
 * has none, which keeps trade-specific controls hidden rather than wrongly
 * shown.
 */
let resolveCapabilities: (businessType: BusinessType) => readonly Capability[] = () => [];

export function setCapabilityResolver(resolver: (businessType: BusinessType) => readonly Capability[]) {
  resolveCapabilities = resolver;
}

/** Non-reactive read, for code paths outside React. */
export function shopHasCapability(capability: Capability): boolean {
  return resolveCapabilities(getStoredBusinessType()).includes(capability);
}

/** Re-renders when the owner changes the shop's business type. */
export function useShopCapability(): (capability: Capability) => boolean {
  const businessType = useBusinessTypeKey();
  return useCallback(
    (capability: Capability) => resolveCapabilities(businessType).includes(capability),
    [businessType],
  );
}
