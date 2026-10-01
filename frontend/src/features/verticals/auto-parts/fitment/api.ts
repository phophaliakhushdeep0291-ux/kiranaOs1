import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type {
  BulkPartFitmentInput,
  FitmentSummary,
  FittingPart,
  PartCrossReference,
  PartCrossReferenceInput,
  PartFitment,
  PartFitmentInput,
  PartNumberLookup,
  VehicleOptions,
} from "@/types/api";

/**
 * Fitment is online-first, like the other trade registers — but with one
 * difference that matters at a counter: the vehicle *search* falls back to a
 * cached copy of the whole fitment table.
 *
 * "Does this fit?" is the question a customer is standing there asking, and
 * answering "check your connection" loses the sale. Recording new fitments needs
 * a connection; looking one up does not.
 */

const FITMENTS_CACHE_KEY = "part-fitments:server-cache:v1";
let cacheVersion = 0;
let cacheValid = true;
let cacheWrite: Promise<void> = Promise.resolve();

// A successful removal must not reappear if the refresh loses its connection.
// Serialise cache writes and reject reads started before a mutation completed.
function writeCache(work: () => Promise<void>) {
  cacheWrite = cacheWrite.then(work, work).catch(() => undefined);
  return cacheWrite;
}

async function readFitmentCache() {
  const version = cacheVersion;
  if (!cacheValid) return undefined;
  const rows = await offlineDB.getSetting<PartFitment[]>(FITMENTS_CACHE_KEY).catch(() => undefined);
  return cacheValid && version === cacheVersion ? rows : undefined;
}

async function invalidateFitmentCache<T>(operation: Promise<T>): Promise<T> {
  const result = await operation;
  cacheVersion += 1;
  cacheValid = false;
  await writeCache(async () => { await offlineDB.setSetting(FITMENTS_CACHE_KEY, null); });
  return result;
}


function isOfflineish(error: unknown) {
  // An auth or permission failure must never be hidden behind stale data.
  return !(error instanceof ApiClientError) || error.status <= 0 || error.status >= 500 || [408, 429].includes(error.status);
}

function matchKey(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

/** The whole fitment table, cached so a lookup still works with no connection. */
export async function listFitments(filters: { make?: string; model?: string; search?: string } = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, String(value));
  }
  const qs = params.toString();
  const version = cacheVersion;
  try {
    const rows = await apiRequest<PartFitment[]>(`/fitment${qs ? `?${qs}` : ""}`, { background: true });
    if (!qs) await writeCache(async () => {
      if (version !== cacheVersion) return;
      await offlineDB.setSetting(FITMENTS_CACHE_KEY, rows);
      if (version === cacheVersion) cacheValid = true;
    });
    return rows;
  } catch (error) {
    if (!isOfflineish(error)) throw error;
    const cached = await readFitmentCache();
    if (cached) return cached.filter((fitment) =>
      (!filters.make || matchKey(fitment.make) === matchKey(filters.make))
      && (!filters.model || matchKey(fitment.model) === matchKey(filters.model))
      && (!filters.search || [fitment.productName, fitment.make, fitment.model, fitment.variant]
        .some((value) => matchKey(value).includes(matchKey(filters.search)))));
    throw error;
  }
}

/**
 * Which parts fit this vehicle.
 *
 * The offline fallback answers from the cached fitment table, but without stock
 * or price — those live in the catalogue, not here. `inCatalogue: false` is how
 * the screen knows to say "we have recorded this as fitting" rather than
 * claiming a shelf count it cannot verify.
 */
export async function findPartsForVehicle(query: { make: string; model?: string; variant?: string; year?: number | string; search?: string }) {
  const year = query.year === undefined || query.year === "" ? null : Number(query.year);
  if (year !== null && (!Number.isInteger(year) || year < 1900 || year > 2100)) {
    throw new ApiClientError("Enter a whole year between 1900 and 2100", 400, { code: "FITMENT_BAD_YEAR" });
  }
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  try {
    return await apiRequest<FittingPart[]>(`/fitment/search?${params.toString()}`, { background: true });
  } catch (error) {
    if (!isOfflineish(error)) throw error;
    const cached = await readFitmentCache();
    if (!cached) throw error;

    const matched = cached.filter((fitment) => {
      if (matchKey(fitment.make) !== matchKey(query.make)) return false;
      if (query.model && matchKey(fitment.model) !== matchKey(query.model)) return false;
      // A fitment with no variant fits every variant — the same rule the server
      // applies, kept in step here so the offline answer never contradicts it.
      if (query.variant && fitment.variant && matchKey(fitment.variant) !== matchKey(query.variant)) return false;
      if (year != null) {
        if (fitment.yearFrom != null && year < fitment.yearFrom) return false;
        if (fitment.yearTo != null && year > fitment.yearTo) return false;
      }
      if (query.search && !matchKey(fitment.productName).includes(matchKey(query.search))) return false;
      return true;
    });

    const byProduct = new Map<string, FittingPart>();
    for (const fitment of matched) {
      const existing = byProduct.get(fitment.productId);
      if (existing) existing.fitments.push(fitment);
      else {
        byProduct.set(fitment.productId, {
          productId: fitment.productId,
          productName: fitment.productName,
          inCatalogue: false,
          stockKnown: false,
          sku: null,
          brand: null,
          stockQty: 0,
          unit: "piece",
          price: 0,
          fitments: [fitment],
        });
      }
    }
    return [...byProduct.values()];
  }
}

export async function getVehicleOptions(make?: string, model?: string) {
  const params = new URLSearchParams();
  if (make) params.set("make", make);
  if (model) params.set("model", model);
  const qs = params.size ? `?${params.toString()}` : "";
  try {
    return await apiRequest<VehicleOptions>(`/fitment/vehicles${qs}`, { background: true });
  } catch (error) {
    if (!isOfflineish(error)) throw error;
    const cached = await readFitmentCache();
    if (!cached) throw error;

    const makes = new Map<string, string>();
    const models = new Map<string, string>();
    const variants = new Map<string, string>();
    for (const fitment of cached) {
      if (!makes.has(matchKey(fitment.make))) makes.set(matchKey(fitment.make), fitment.make);
      if (!make || matchKey(fitment.make) === matchKey(make)) {
        if (!models.has(matchKey(fitment.model))) models.set(matchKey(fitment.model), fitment.model);
        if ((!model || matchKey(fitment.model) === matchKey(model))
          && fitment.variant && !variants.has(matchKey(fitment.variant))) variants.set(matchKey(fitment.variant), fitment.variant);
      }
    }
    const sorted = (map: Map<string, string>) => [...map.values()].sort((a, b) => a.localeCompare(b));
    return { makes: sorted(makes), models: sorted(models), variants: sorted(variants) };
  }
}

export function findByPartNumber(partNumber: string) {
  return apiRequest<PartNumberLookup>(`/fitment/part-number/${encodeURIComponent(partNumber)}`, { background: true });
}

export function getFitmentSummary() {
  return apiRequest<FitmentSummary>("/fitment/summary", { background: true });
}

/** What one part fits, and what else will do instead. */
export function getFitmentForProduct(productId: string) {
  return apiRequest<{ fitments: PartFitment[]; references: PartCrossReference[] }>(
    `/fitment/for-product/${productId}`,
    { background: true },
  );
}

export function createFitment(data: PartFitmentInput) {
  return invalidateFitmentCache(apiRequest<PartFitment>("/fitment", { method: "POST", body: JSON.stringify(data) }));
}

export function createFitmentsBulk(data: BulkPartFitmentInput) {
  return invalidateFitmentCache(apiRequest<{ created: PartFitment[]; skipped: PartFitment[] }>("/fitment/bulk", {
    method: "POST",
    body: JSON.stringify(data),
  }));
}

export function updateFitment(id: string, data: Partial<Omit<PartFitmentInput, "productId">>) {
  return invalidateFitmentCache(apiRequest<PartFitment>(`/fitment/${id}`, { method: "PATCH", body: JSON.stringify(data) }));
}

export function deleteFitment(id: string) {
  return invalidateFitmentCache(apiRequest<PartFitment>(`/fitment/${id}`, { method: "DELETE" }));
}

export function createCrossReference(data: PartCrossReferenceInput) {
  return apiRequest<PartCrossReference>("/fitment/references", { method: "POST", body: JSON.stringify(data) });
}

export function deleteCrossReference(id: string) {
  return apiRequest<PartCrossReference>(`/fitment/references/${id}`, { method: "DELETE" });
}
