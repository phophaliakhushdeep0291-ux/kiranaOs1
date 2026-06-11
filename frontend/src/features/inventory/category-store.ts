import { offlineDB } from "@/lib/offline/db";

export type CategoryStatus = "active" | "inactive";

export interface ShopCategory {
  id: string;
  name: string;
  parentId: string | null;
  status: CategoryStatus;
  createdAt: string;
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
