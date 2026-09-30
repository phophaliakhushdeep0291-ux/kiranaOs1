/** Vertical ledgers commit with the shared bill reversal, never after it. */
const handlers = [];
export function registerBillLifecycle(handler) { handlers.push(handler); }
export async function runBillLifecycle(event, context) {
  for (const handler of handlers) await handler[event]?.(context);
}
