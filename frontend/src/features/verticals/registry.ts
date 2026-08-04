import { useMemo } from "react";
import {
  getStoredBusinessType,
  useBusinessTypeKey,
  type BusinessType,
} from "@/features/core/settings/business-type-store";
import type { Capability, VerticalId, VerticalPack } from "./types";
import { kiranaPack } from "./kirana/pack";
import { clothingPack } from "./clothing/pack";
import { footwearPack } from "./footwear/pack";
import { autoPartsPack } from "./auto-parts/pack";
import { electronicsPack } from "./electronics/pack";
import { pharmacyPack } from "./pharmacy/pack";
import { stationeryPack } from "./stationery-books/pack";
import { furniturePack } from "./furniture-home/pack";
import { cosmeticsPack } from "./beauty-cosmetics/pack";
import { restaurantPack } from "./restaurant/pack";
import { customPack } from "./custom/pack";

export type { VerticalId, VerticalPack, VerticalRoute, VerticalNavEntry, VerticalPageId, Capability } from "./types";

/** Every shop type owns exactly one explicit pack, even before it has exclusive screens. */
export const VERTICAL_PACKS: readonly VerticalPack[] = [
  kiranaPack,
  clothingPack,
  footwearPack,
  autoPartsPack,
  electronicsPack,
  pharmacyPack,
  stationeryPack,
  furniturePack,
  cosmeticsPack,
  restaurantPack,
  customPack,
];

const PACK_BY_BUSINESS_TYPE = new Map<BusinessType, VerticalPack>();
for (const pack of VERTICAL_PACKS) {
  for (const businessType of pack.businessTypes) {
    if (PACK_BY_BUSINESS_TYPE.has(businessType)) throw new Error(`Duplicate vertical pack for ${businessType}`);
    PACK_BY_BUSINESS_TYPE.set(businessType, pack);
  }
}

export function packForBusinessType(businessType: BusinessType): VerticalPack {
  const pack = PACK_BY_BUSINESS_TYPE.get(businessType);
  if (!pack) throw new Error(`No vertical pack registered for ${businessType}`);
  return pack;
}

export function getActiveVerticalPack(): VerticalPack {
  return packForBusinessType(getStoredBusinessType());
}

export function useActiveVerticalPack(): VerticalPack {
  const businessType = useBusinessTypeKey();
  return useMemo(() => packForBusinessType(businessType), [businessType]);
}

/**
 * Whether this shop's trade can do something. Non-reactive; prefer the hook in
 * components so the answer updates when the owner changes the business type.
 *
 * Branch on this, never on the business type itself: "does this shop sell
 * loose?" is a question about the trade's behaviour, and the list of trades
 * that answer yes changes (kirana and stationery today) without the calling
 * screen needing to care.
 */
export function shopHasCapability(capability: Capability): boolean {
  return getActiveVerticalPack().capabilities.includes(capability);
}

export function useShopCapabilities(): (capability: Capability) => boolean {
  const pack = useActiveVerticalPack();
  return useMemo(() => (capability: Capability) => pack.capabilities.includes(capability), [pack]);
}

function cleanPath(path: string) {
  return (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
}

export function verticalForPath(path: string): VerticalId | null {
  const target = cleanPath(path);
  let best: { id: VerticalId; length: number } | null = null;
  for (const pack of VERTICAL_PACKS) {
    for (const owned of pack.paths) {
      const root = cleanPath(owned);
      if (target !== root && !target.startsWith(`${root}/`)) continue;
      if (!best || root.length > best.length) best = { id: pack.id, length: root.length };
    }
  }
  return best?.id ?? null;
}

function pathAllowedFor(path: string, active: VerticalId): boolean {
  const owner = verticalForPath(path);
  return owner === null || owner === active;
}

export function isVerticalPathActive(path: string): boolean {
  return pathAllowedFor(path, getActiveVerticalPack().id);
}

export function useIsVerticalPathActive(): (path: string) => boolean {
  const active = useActiveVerticalPack();
  return useMemo(() => (path: string) => pathAllowedFor(path, active.id), [active.id]);
}
