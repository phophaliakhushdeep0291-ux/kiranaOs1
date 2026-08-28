/**
 * Sale guards — the seam that lets one trade refuse a sale the shared billing
 * path would otherwise happily confirm.
 *
 * A Schedule H medicine cannot leave the shop without a doctor's slip, but only
 * the pharmacy pack knows what Schedule H means. Billing must not import
 * pharmacy to find out: shared code that names one trade makes that trade's bugs
 * and releases every shop's problem, which is the rule
 * tests/business-vertical-architecture.examples.js enforces. So a vertical
 * registers its guard here at load time and billing asks the registry instead.
 *
 * The arrow points one way, exactly as it does for catalog availability. A shop
 * with no guards registered runs the same billing path and pays one array-length
 * check for it.
 */

const guards = [];

/**
 * @param {(context: {
 *   shopId: string,
 *   tx: object,
 *   body: object,
 *   items: Array<object>,
 *   productMap: Record<string, object>,
 *   isEstimate: boolean,
 * }) => Promise<null | { code?: string, message?: string, status?: number, publicData?: object, onConfirmed?: Function, decorateBillItem?: Function }>} guard
 *   Returns null to allow the sale, or a refusal describing why. `onConfirmed`,
 *   when present, runs after the bill exists — that is where a guard records
 *   what its own ledger needs to say about the sale it just permitted.
 *
 *   `stockHandledProductIds` claims a line's stock: billing will not decrement
 *   those products, because the guard has already moved what actually left the
 *   store room. A restaurant uses it for dishes — nobody stocks a cooked plate,
 *   its ingredients are what leave the fridge — and without it one sale moved
 *   stock twice: once against a real ingredient and once against a number that
 *   means nothing and that no purchase order ever puts back.
 */
export function registerSaleGuard(guard) {
  if (typeof guard !== "function") throw new TypeError("A sale guard must be a function");
  guards.push(guard);
}

/**
 * Run every guard against one sale.
 *
 * Returns `{ refusal, onConfirmed }`. The FIRST refusal wins and stops the rest:
 * a counter that has to clear three separate objections one attempt at a time is
 * a counter that works around the feature instead of with it.
 */
export async function evaluateSaleGuards(context) {
  const empty = { refusal: null, onConfirmed: [], decorateBillItem: [], stockHandledProductIds: new Set() };
  if (guards.length === 0) return empty;

  const onConfirmed = [];
  const decorateBillItem = [];
  const stockHandledProductIds = new Set();
  for (const guard of guards) {
    const result = await guard(context);
    if (!result) continue;
    if (result.code) return { ...empty, refusal: result };
    if (result.onConfirmed) onConfirmed.push(result.onConfirmed);
    if (result.decorateBillItem) decorateBillItem.push(result.decorateBillItem);
    for (const productId of result.stockHandledProductIds ?? []) stockHandledProductIds.add(productId);
  }
  return { refusal: null, onConfirmed, decorateBillItem, stockHandledProductIds };
}

/** Test seam: drop every registration so one suite cannot leak into the next. */
export function resetSaleGuards() {
  guards.length = 0;
}
