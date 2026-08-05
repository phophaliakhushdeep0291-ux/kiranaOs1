import { ApiClientError, apiRequest } from "@/lib/api/http";
import { offlineDB } from "@/lib/offline/db";
import type {
  ShoeSizeEquivalents,
  SizeLookup,
  SizeProfileInput,
  SizeRun,
  SizeRunSummary,
} from "@/types/api";

/**
 * Size runs are read-mostly, and the reading works offline.
 *
 * "Have you got this in an 8?" is asked with a customer standing there, and the
 * answer is derived from stock this device already holds — so the run list is
 * cached and the lookup falls back to it. Declaring a style's size system is the
 * only write, and that can wait for a connection.
 */

const RUNS_CACHE_KEY = "size-runs:server-cache:v1";

function isOfflineish(error: unknown) {
  // An auth or permission failure must never be hidden behind stale data.
  return !(error instanceof ApiClientError) || error.status <= 0 || error.status >= 500 || [408, 429].includes(error.status);
}

export async function listSizeRuns(filters: { search?: string; onlyBroken?: boolean } = {}) {
  const params = new URLSearchParams();
  if (filters.search) params.set("search", filters.search);
  if (filters.onlyBroken) params.set("onlyBroken", "true");
  const qs = params.toString();
  try {
    const runs = await apiRequest<SizeRun[]>(`/size-runs${qs ? `?${qs}` : ""}`, { background: true });
    if (!qs) await offlineDB.setSetting(RUNS_CACHE_KEY, runs).catch(() => undefined);
    return runs;
  } catch (error) {
    if (!isOfflineish(error)) throw error;
    const cached = await offlineDB.getSetting<SizeRun[]>(RUNS_CACHE_KEY).catch(() => undefined);
    if (!cached) throw error;
    const term = (filters.search ?? "").trim().toLowerCase();
    return cached
      .filter((run) => (!term || run.productName.toLowerCase().includes(term) || (run.brand ?? "").toLowerCase().includes(term)))
      .filter((run) => (!filters.onlyBroken || run.isBroken || run.isEmpty));
  }
}

export function getSizeRun(productId: string) {
  return apiRequest<SizeRun>(`/size-runs/${productId}`, { background: true });
}

export function getSizeRunSummary() {
  return apiRequest<SizeRunSummary>("/size-runs/summary", { background: true });
}

/**
 * Which styles carry a customer's size, answered in each style's own numbering.
 *
 * The offline path re-derives this from the cached runs rather than giving up:
 * every cell already carries its equivalents, so the match can be made on the
 * device. What it cannot do is invent a conversion the server never sent.
 */
export async function findBySize(system: string, value: string, gender = "unisex") {
  const params = new URLSearchParams({ system, value, gender });
  try {
    return await apiRequest<SizeLookup>(`/size-runs/find?${params.toString()}`, { background: true });
  } catch (error) {
    if (!isOfflineish(error)) throw error;
    const cached = await offlineDB.getSetting<SizeRun[]>(RUNS_CACHE_KEY).catch(() => undefined);
    if (!cached) throw error;

    const wanted = value.trim().toLowerCase();
    // Any cached cell for this size tells us what it is called on every scale.
    const equivalents = cached
      .flatMap((run) => run.cells)
      .find((cell) => cell.equivalents && String(cell.equivalents[system as keyof ShoeSizeEquivalents] ?? "").toLowerCase() === wanted)
      ?.equivalents ?? null;

    const matches = [];
    for (const run of cached) {
      const inStyle = equivalents ? equivalents[run.sizeSystem] : (run.sizeSystem === system ? value.trim() : null);
      if (!inStyle) continue;
      const cells = run.cells.filter((cell) => cell.size.trim() === String(inStyle).trim() && cell.inStock);
      if (cells.length === 0) continue;
      matches.push({
        productId: run.productId,
        productName: run.productName,
        brand: run.brand ?? null,
        sizeSystem: run.sizeSystem,
        gender: run.gender,
        sizeInStyleSystem: String(inStyle),
        pairs: cells.reduce((sum, cell) => sum + cell.pairs, 0),
        colours: cells.map((cell) => cell.colour).filter(Boolean) as string[],
      });
    }

    return {
      asked: { system, value: value.trim(), gender },
      equivalents,
      ladder: [],
      matches: matches.sort((a, b) => b.pairs - a.pairs),
    } as SizeLookup;
  }
}

/** The chart alone, with no shop data in it — useful before anything is profiled. */
export function convertSize(system: string, value: string, gender = "unisex") {
  const params = new URLSearchParams({ system, value, gender });
  return apiRequest<{ equivalents: ShoeSizeEquivalents | null; ladder: string[] }>(
    `/size-runs/convert?${params.toString()}`,
    { background: true },
  );
}

export function setSizeProfile(productId: string, data: SizeProfileInput) {
  return apiRequest<{ id: string; sizeSystem: string; gender: string }>(`/size-runs/${productId}/profile`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}
