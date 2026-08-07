import type { Product } from "@/types/api";
import {
  fingerprintProductImport,
  parseProductsCsv,
  planProductImport,
  type ProductImportStrategy,
} from "@/features/core/products/import/product-import-csv";
import {
  importProductsLocalFirst,
  type ProductImportOperation,
} from "@/features/core/products/local-actions";
import { offlineDB } from "@/lib/offline/db";
import { starterCatalogToCsv, type StarterCatalogItem } from "./starter-catalog";

/**
 * Load the built-in kirana starter catalog into this shop.
 *
 * Three things this deliberately does NOT do:
 *
 *  - It does not create products itself. It renders the catalog as the CSV the normal
 *    importer already accepts and hands it to parseProductsCsv → planProductImport →
 *    importProductsLocalFirst. One product-creation path means one set of validation
 *    rules, one audit trail, and one outbox shape to keep correct.
 *  - It does not invent an idempotency key. importProductsLocalFirst already puts the
 *    local product id in the outbox payload as `localProductId`, which the server reads
 *    as `clientProductId` and dedupes a create against. Queueing offline and syncing
 *    later therefore produces one server product per row, however many times the
 *    outbox is retried.
 *  - It does not roll back. Cancelling stops before the next chunk; the products already
 *    committed stay. A half-loaded catalog is a shop with fewer items to delete. A
 *    rollback that ran while the outbox was mid-push would be a corrupted one.
 */

/** Rows per IndexedDB transaction. Small enough to cancel promptly, large enough that
 * 560 products is ~14 transactions rather than 560. */
const DEFAULT_CHUNK_SIZE = 40;

export const STARTER_CATALOG_FILE_NAME = "Artha starter catalog (kirana)";

export interface StarterCatalogImportProgress {
  /** Products actually created so far. */
  created: number;
  /** Products this run set out to create — already-present rows are not counted. */
  total: number;
}

export interface StarterCatalogImportResult {
  /** Rows in the built-in catalog. */
  catalogCount: number;
  /** Rows this run planned to create. */
  planned: number;
  created: number;
  /** Rows the shop already had. The second run of the same catalog is all skips. */
  skipped: number;
  /** Rows the importer rejected. Expected to be 0 — the catalog is generated, not typed. */
  invalid: number;
  cancelled: boolean;
}

export interface StarterCatalogImportOptions {
  signal?: AbortSignal;
  onProgress?: (progress: StarterCatalogImportProgress) => void;
  chunkSize?: number;
  /**
   * Present so the caller states its intent rather than inheriting a default. Loading a
   * starter catalog must never overwrite a shop's own prices, so this stays skip-existing.
   */
  strategy?: ProductImportStrategy;
}

/**
 * Fetch the catalog itself.
 *
 * The dynamic import is the whole point: 560 rows are ~200 kB of module, and a counter
 * that never opens first-run setup must never download them. Keep this the only place
 * that names the generated module, and keep it dynamic.
 */
export async function loadStarterCatalog(): Promise<readonly StarterCatalogItem[]> {
  const module = await import("./kirana-catalog.generated");
  return module.KIRANA_STARTER_CATALOG;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

export async function runStarterCatalogImport(
  options: StarterCatalogImportOptions = {},
): Promise<StarterCatalogImportResult> {
  const { signal, onProgress, chunkSize = DEFAULT_CHUNK_SIZE, strategy = "skip-existing" } = options;

  const catalog = await loadStarterCatalog();
  const csv = starterCatalogToCsv(catalog);
  const parsed = parseProductsCsv(csv);
  if (parsed.headerError) {
    // The catalog is generated from the importer's own column list, so this can only mean
    // the two have drifted apart — a bug to fix, not a shop's malformed spreadsheet.
    throw new Error(`The built-in catalog no longer matches the importer: ${parsed.headerError}`);
  }

  // Planned once, against the products that exist now. Rows the shop already has become
  // skips, which is what makes a second run — or a resumed cancelled run — create nothing.
  const existingProducts = await offlineDB.getAll<Product>("products");
  const plan = planProductImport(parsed, existingProducts, strategy);

  const operations: ProductImportOperation[] = plan.rows.flatMap((row) => {
    if ((row.action !== "create" && row.action !== "update") || !row.finalInput) return [];
    return [{
      action: row.action,
      rowNumber: row.rowNumber,
      input: row.finalInput,
      existingProductId: row.matchedProductId,
    }];
  });

  const baseFingerprint = fingerprintProductImport(csv);
  const batches = chunk(operations, Math.max(1, chunkSize));
  const result: StarterCatalogImportResult = {
    catalogCount: catalog.length,
    planned: operations.length,
    created: 0,
    skipped: plan.skipCount,
    invalid: plan.errorCount,
    cancelled: false,
  };

  onProgress?.({ created: 0, total: operations.length });

  for (let index = 0; index < batches.length; index += 1) {
    // Checked between transactions, never inside one. A chunk is all-or-nothing; stopping
    // partway through would be the corruption the no-rollback rule exists to avoid.
    if (signal?.aborted) {
      result.cancelled = true;
      break;
    }

    const batch = batches[index];
    await importProductsLocalFirst(batch, {
      // Each chunk is its own session record. Sharing one fingerprint would make every
      // chunk overwrite the previous chunk's session under the same settings key.
      fingerprint: `${baseFingerprint}-part${index + 1}`,
      fileName: `${STARTER_CATALOG_FILE_NAME}, part ${index + 1} of ${batches.length}`,
      source: parsed.source,
      totalRows: batch.length,
      // Run-level skips and rejects belong to the run, not to any one chunk; they are
      // reported in the returned result instead of being restated on all 14 sessions.
      skippedRows: 0,
      errorRows: 0,
    });

    result.created += batch.length;
    onProgress?.({ created: result.created, total: operations.length });
  }

  return result;
}
