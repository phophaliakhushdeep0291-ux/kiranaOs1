/**
 * Bill lifecycle — the seam that lets one trade's own ledger follow a bill after
 * it has been confirmed.
 *
 * `sale-guards.js` covers the moment of sale. But a bill is also cancelled,
 * restored and returned against, and a trade that keeps a record per sale has to
 * hear about each of those too: an electronics shop's IMEI register must put the
 * handset back on the shelf when its bill is cancelled, or the register says
 * "sold" about a phone sitting under the counter.
 *
 * Billing must not import a trade to tell it — the same rule
 * tests/business-vertical-architecture.examples.js enforces for guards — so a
 * vertical registers a handler here at load time and billing calls the registry
 * from inside its own transaction.
 *
 * Inside the transaction is the point. A handler's write commits with the stock
 * and money it belongs to or not at all; run afterwards, a crash between the two
 * leaves a cancelled bill whose handset is still marked sold.
 *
 * A handler follows the bill. It may refuse a request that makes no sense for
 * its own record — half a handset cannot come back — but finding that record in
 * a state it did not expect is a reason to leave the record alone, never to
 * refuse the reversal: the stock and the money are the part that must happen.
 */

const handlers = [];

/**
 * @param {{
 *   cancel?: (context: { tx: object, shopId: string, bill: object }) => Promise<void>,
 *   restore?: (context: { tx: object, shopId: string, bill: object }) => Promise<void>,
 *   return?: (context: { tx: object, shopId: string, bill: object, original: object, requests: Array<object> }) => Promise<void>,
 * }} handler
 *   `bill` carries its items. For `return` it is the return bill just created,
 *   `original` is the sale being returned against, and `requests` are the lines
 *   the counter asked to take back.
 */
export function registerBillLifecycle(handler) {
  if (!handler || typeof handler !== "object") throw new TypeError("A bill lifecycle handler must be an object");
  handlers.push(handler);
}

/** Run every handler that has something to do for this event, in registration order. */
export async function runBillLifecycle(event, context) {
  for (const handler of handlers) await handler[event]?.(context);
}

/** Test seam: drop every registration so one suite cannot leak into the next. */
export function resetBillLifecycle() {
  handlers.length = 0;
}
