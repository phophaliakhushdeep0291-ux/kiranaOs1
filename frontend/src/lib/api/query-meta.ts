/**
 * Marks a query a local write or a sync can never change — server settings and
 * capability checks, not shop data.
 *
 * The realtime refresh bridge refetches every query on screen whenever local
 * data changes, so a single sale refetched the shop profile, the store list,
 * the loyalty programme and both payment-readiness checks two or three times
 * over — about sixteen of the forty-odd requests the selling counter made per
 * sale. Queries carrying this meta are left to their own staleTime instead. Leave
 * it off anything a sale, payment, stock change or sync can move: an unmarked
 * query is simply refreshed as before.
 */
export const UNAFFECTED_BY_LOCAL_DATA = { refreshOnLocalData: false } as const;

export function refreshesOnLocalData(query: { meta?: Record<string, unknown> }): boolean {
  return query.meta?.refreshOnLocalData !== false;
}
