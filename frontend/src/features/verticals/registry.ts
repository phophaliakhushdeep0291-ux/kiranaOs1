import { useMemo } from "react";
// The store, not `business-types` — the router imports this file, so pulling the
// per-trade copy in here would put all eleven trades' labels in the startup shell.
import {
  getStoredBusinessType,
  useBusinessTypeKey,
  type BusinessType,
} from "@/features/core/settings/business-type-store";
import type { VerticalId, VerticalPack } from "./types";
import { kiranaPack } from "./kirana/pack";
import { clothingPack } from "./clothing/pack";
import { pharmacyPack } from "./pharmacy/pack";
import { restaurantPack } from "./restaurant/pack";
import { generalPack } from "./general/pack";

export type { VerticalId, VerticalPack, VerticalRoute, VerticalNavEntry, VerticalPageId } from "./types";

/**
 * Every pack in the app. Importing them all here is cheap: a manifest is a few
 * strings and an icon, and the pages behind `routes` stay lazy, so an inactive
 * trade's screens are never downloaded.
 */
export const VERTICAL_PACKS: readonly VerticalPack[] = [
  kiranaPack,
  clothingPack,
  pharmacyPack,
  restaurantPack,
  generalPack,
];

const PACK_BY_BUSINESS_TYPE = new Map<BusinessType, VerticalPack>();
for (const pack of VERTICAL_PACKS) {
  for (const businessType of pack.businessTypes) PACK_BY_BUSINESS_TYPE.set(businessType, pack);
}

export function packForBusinessType(businessType: BusinessType): VerticalPack {
  // `general` catches a business type no pack claimed, so a shop is never left
  // without a pack — the registry test is what keeps that from going unnoticed.
  return PACK_BY_BUSINESS_TYPE.get(businessType) ?? generalPack;
}

/** Non-reactive read, for code paths outside React. */
export function getActiveVerticalPack(): VerticalPack {
  return packForBusinessType(getStoredBusinessType());
}

/** Re-renders the moment the owner changes the shop's business type. */
export function useActiveVerticalPack(): VerticalPack {
  const businessType = useBusinessTypeKey();
  return useMemo(() => packForBusinessType(businessType), [businessType]);
}

function cleanPath(path: string) {
  return (path.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
}

/** Which pack owns a route, longest prefix first. Null for the shared core routes. */
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

/**
 * Whether a path is reachable by the shop in front of us: true for every core
 * route, true for the active trade's own routes, false for another trade's.
 * Non-reactive; `useIsVerticalPathActive` is the hook form.
 */
export function isVerticalPathActive(path: string): boolean {
  return pathAllowedFor(path, getActiveVerticalPack().id);
}

export function useIsVerticalPathActive(): (path: string) => boolean {
  const active = useActiveVerticalPack();
  return useMemo(() => (path: string) => pathAllowedFor(path, active.id), [active.id]);
}
