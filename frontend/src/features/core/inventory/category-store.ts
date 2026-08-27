import { offlineDB } from "@/lib/offline/db";

export type CategoryStatus = "active" | "inactive";

export interface ShopCategory {
  id: string;
  name: string;
  parentId: string | null;
  status: CategoryStatus;
  createdAt: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

export function mergeCategories(...lists: Array<ShopCategory[] | null | undefined>): ShopCategory[] {
  const merged = new Map<string, ShopCategory>();
  for (const list of lists) for (const category of list ?? []) {
    if (!category?.id || !category.name) continue;
    const normalized = { ...category, updatedAt: category.updatedAt ?? category.createdAt, deletedAt: category.deletedAt ?? null };
    const current = merged.get(category.id);
    if (!current || String(normalized.updatedAt) > String(current.updatedAt ?? current.createdAt)) merged.set(category.id, normalized);
  }
  return [...merged.values()];
}

const KEY = "kirana:categories:v1";

export function newCategoryId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `cat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

export async function loadCategories(): Promise<ShopCategory[] | null> {
  const stored = await offlineDB.getSetting<ShopCategory[]>(KEY).catch(() => null);
  return stored ?? null;
}

export async function saveCategories(list: ShopCategory[]): Promise<void> {
  await offlineDB.setSetting(KEY, list).catch(() => undefined);
}

/**
 * Categories are stored as records for sync and hierarchy, while products only
 * store the chosen category name. Keep the picker list to names that can still
 * be selected: deleted and inactive categories remain in storage for history
 * and sync, but must not be offered for a new product.
 */
export function activeCategoryNames(categories: ShopCategory[] | null | undefined): string[] {
  const names = new Map<string, string>();
  for (const category of categories ?? []) {
    const name = category?.name?.trim();
    if (!name || category.deletedAt || category.status !== "active") continue;
    const key = name.toLocaleLowerCase();
    if (!names.has(key)) names.set(key, name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

/** ids of every descendant of `id` (to prevent cycles when choosing a parent). */
export function descendantIds(id: string, list: ShopCategory[]): Set<string> {
  const out = new Set<string>();
  const walk = (parentId: string) => {
    for (const c of list) {
      if (c.parentId === parentId && !out.has(c.id)) {
        out.add(c.id);
        walk(c.id);
      }
    }
  };
  walk(id);
  return out;
}
