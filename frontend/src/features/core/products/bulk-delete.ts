import { inventoryBaseQuantity, inventoryStockValue } from "@/features/core/inventory/stock-display";
import { deleteProductLocalFirst } from "@/features/core/products/local-actions";
import { isDeletedProduct } from "@/features/core/products/pages/product-pricing";
import type { Product } from "@/types/api";

/**
 * Bulk "move to recycle bin" for the Products screen.
 *
 * Deleting one product is a considered act — the shopkeeper reads the name in a
 * confirmation. Deleting two hundred is not, so the risky parts live here, unit-tested
 * away from the screen: what the shop is about to lose (§summariseBulkDelete) and the
 * loop that carries the owner's approval to every single row (§runBulkProductDelete).
 */

export type SelectedProduct = Product & Record<string, unknown>;

export interface BulkDeleteCategory {
  name: string;
  count: number;
}

export interface BulkDeleteSummary {
  total: number;
  /** Rows still holding stock — the ones a shopkeeper regrets deleting. */
  withStock: number;
  /** Value of that stock at average cost, selling-unit aware. */
  stockValue: number;
  /** Largest group first: "you are deleting 32 of Cosmetics" is the real question. */
  categories: BulkDeleteCategory[];
}

/**
 * What the selection actually contains, for the confirmation screen.
 *
 * Stock is read through the inventory helpers rather than `stockQuantity`: for a packed
 * product those two disagree by the pack size, and a warning that says "₹120 of stock"
 * about ₹120,000 of stock is worse than no warning at all.
 */
export function summariseBulkDelete(products: SelectedProduct[]): BulkDeleteSummary {
  const counts = new Map<string, number>();
  let withStock = 0;
  let stockValue = 0;

  for (const product of products) {
    const category = String(product.category ?? "").trim() || "general";
    counts.set(category, (counts.get(category) ?? 0) + 1);
    if (inventoryBaseQuantity(product) > 0) {
      withStock += 1;
      stockValue += inventoryStockValue(product);
    }
  }

  return {
    total: products.length,
    withStock,
    stockValue: Math.round(stockValue * 100) / 100,
    categories: [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

export interface BulkDeleteProgress {
  /** Rows finished, whether they were deleted, skipped or failed. */
  done: number;
  total: number;
}

export interface BulkDeleteFailure {
  id: string;
  name: string;
  message: string;
}

export interface BulkDeleteResult {
  deleted: number;
  /** Rows already in the recycle bin when the run started. */
  skipped: number;
  failures: BulkDeleteFailure[];
  cancelled: boolean;
}

export interface BulkDeleteOptions {
  ownerPin: string;
  reason: string;
  signal?: AbortSignal;
  onProgress?: (progress: BulkDeleteProgress) => void;
}

/**
 * Move every selected product to the recycle bin, one at a time.
 *
 * Three deliberate choices:
 *
 * 1. It calls `deleteProductLocalFirst` per product rather than adding a bulk delete
 *    path. That function is what re-validates the owner PIN, writes the audit row and
 *    queues DELETE_PRODUCT_PENDING in one transaction; a faster loop that wrote
 *    tombstones directly would be a second set of rules to keep correct, and the one
 *    place where the PIN check could quietly go missing.
 * 2. The PIN is passed to EVERY call, not checked once up front. Each deletion is
 *    independently approved and independently stamped `ownerPinProvided` in the audit
 *    trail, which is what makes the trail answer "who authorised this row".
 * 3. A failure does not stop the run and does not roll back what already committed.
 *    These are soft deletes: every row is restorable from the recycle bin on its own,
 *    so stopping at the first failure would only leave a half-done job with no report.
 *    The failures are collected and named instead.
 */
export async function runBulkProductDelete(
  products: SelectedProduct[],
  { ownerPin, reason, signal, onProgress }: BulkDeleteOptions,
): Promise<BulkDeleteResult> {
  const total = products.length;
  const failures: BulkDeleteFailure[] = [];
  let deleted = 0;
  let skipped = 0;

  onProgress?.({ done: 0, total });

  for (const product of products) {
    // Checked between products, never inside one: a delete already handed to IndexedDB
    // is committed, and abandoning it there is the half-written state this avoids.
    if (signal?.aborted) return { deleted, skipped, failures, cancelled: true };

    if (isDeletedProduct(product)) {
      skipped += 1;
    } else {
      try {
        await deleteProductLocalFirst(product.id, ownerPin, reason);
        deleted += 1;
      } catch (error) {
        failures.push({
          id: product.id,
          name: product.name,
          message: error instanceof Error ? error.message : "Could not delete this product.",
        });
      }
    }
    onProgress?.({ done: deleted + skipped + failures.length, total });
  }

  return { deleted, skipped, failures, cancelled: false };
}
