import {
  fingerprintProductImport,
  parseProductsCsv,
  planProductImport,
} from "@/features/core/products/import/product-import-csv";
import { importProductsLocalFirst, type ProductImportOperation } from "@/features/core/products/local-actions";
import { offlineDB } from "@/lib/offline/db";
import type { Product } from "@/types/api";
import { starterCatalogToCsv, type StarterCatalogItem } from "./starter-catalog";

/** Reads as a built-in in the audit trail, not as a spreadsheet someone happened to upload. */
export const STARTER_CATALOG_FILE_NAME = "Artha kirana starter catalog";
export const STARTER_CATALOG_SOURCE = "starter-catalog";

/**
 * 560 products is a few seconds of IndexedDB work, so it is committed in batches.
 *
 * Batching is what makes both the progress number and Cancel honest: each batch is one
 * atomic transaction, so stopping half way leaves whole products behind, never half of
 * one. A single 560-row transaction could only offer a spinner and an all-or-nothing
 * rollback, which is the opposite of what a shopkeeper wants after waiting.
 */
const DEFAULT_BATCH_SIZE = 40;

export interface StarterCatalogProgress {
  /** Products actually committed so far. */
  created: number;
  /** Products this run will create — already net of anything the shop has. */
  total: number;
}

export interface StarterCatalogLoadResult {
  created: number;
  /** Rows the shop already had. On a second run this is the whole catalog. */
  skipped: number;
  invalid: number;
  total: number;
  cancelled: boolean;
}

export interface LoadStarterCatalogOptions {
  signal?: AbortSignal;
  onProgress?: (progress: StarterCatalogProgress) => void;
  batchSize?: number;
}

/**
 * Load catalog items into the shop through the ordinary product-import pipeline.
 *
 * Deliberately not a faster bespoke path: rendering the items back to CSV and running
 * parseProductsCsv → planProductImport → importProductsLocalFirst means the built-in
 * gets the same validation, the same duplicate reconciliation, the same audit rows and
 * the same outbox operations as a shopkeeper's own file. A second product-creation route
 * would be a second set of rules to keep correct forever.
 */
export async function importStarterCatalogItems(
  items: readonly StarterCatalogItem[],
  { signal, onProgress, batchSize = DEFAULT_BATCH_SIZE }: LoadStarterCatalogOptions = {},
): Promise<StarterCatalogLoadResult> {
  const csv = starterCatalogToCsv(items);
  const parsed = parseProductsCsv(csv);
  if (parsed.headerError) throw new Error(`The built-in catalog did not parse: ${parsed.headerError}`);

  /*
   * Planning against what is already local is the entire idempotency story. The catalog
   * ships no barcodes on purpose, so "skip-existing" reconciles on name + brand + unit +
   * pack size: a second run plans all 560 rows as skips and creates nothing. Reading
   * products here rather than trusting a count is also what lets a cancelled load resume
   * and pick up only what is missing.
   */
  const existing = await offlineDB.getAll<Product>("products");
  const plan = planProductImport(parsed, existing, "skip-existing");
  const operations: ProductImportOperation[] = plan.rows.flatMap((row) => (
    row.action === "create" && row.finalInput
      ? [{ action: "create" as const, rowNumber: row.rowNumber, input: row.finalInput }]
      : []
  ));

  const fingerprint = fingerprintProductImport(csv);
  const total = operations.length;
  let created = 0;
  onProgress?.({ created, total });

  for (let offset = 0; offset < total; offset += batchSize) {
    // Checked between batches only: a batch already handed to IndexedDB is committed, and
    // abandoning it there is what would leave the half-written state this design avoids.
    if (signal?.aborted) return { created, skipped: plan.skipCount, invalid: plan.errorCount, total, cancelled: true };

    const batch = operations.slice(offset, offset + batchSize);
    await importProductsLocalFirst(batch, {
      // One session record per committed batch. They are genuinely separate transactions,
      // and a shared fingerprint would make each batch overwrite the previous batch's
      // session under the same settings key.
      fingerprint: `${fingerprint}-${offset / batchSize}`,
      fileName: STARTER_CATALOG_FILE_NAME,
      source: STARTER_CATALOG_SOURCE,
      totalRows: batch.length,
      skippedRows: 0,
      errorRows: 0,
    });
    created += batch.length;
    onProgress?.({ created, total });
  }

  return { created, skipped: plan.skipCount, invalid: plan.errorCount, total, cancelled: false };
}

/**
 * Fetch the built-in kirana catalog and load it.
 *
 * The dynamic import is the point: this is the only reference to the generated module in
 * application code, so the bundler gives it its own chunk. A counter that never opens
 * first-run setup never downloads those 560 rows, and because the chunk is reached only
 * through a dynamic import it also stays out of the service worker's precache manifest.
 */
export async function loadKiranaStarterCatalog(
  options: LoadStarterCatalogOptions = {},
): Promise<StarterCatalogLoadResult> {
  const { KIRANA_STARTER_CATALOG } = await import("./kirana-catalog.generated");
  return importStarterCatalogItems(KIRANA_STARTER_CATALOG, options);
}
