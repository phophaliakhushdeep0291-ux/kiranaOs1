import { withCrossTabLock } from "@/lib/browser/multiTabCoordinator";
import { getOfflineScope } from "@/lib/offline/context";

const inProcessTails = new Map<string, Promise<void>>();

async function withInProcessLock<T>(name: string, callback: () => Promise<T>): Promise<T> {
  const previous = inProcessTails.get(name) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  inProcessTails.set(name, tail);
  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (inProcessTails.get(name) === tail) inProcessTails.delete(name);
  }
}

/** Serialize due/payment decisions for one purchase across tabs and this JS realm. */
export function withPurchaseFinancialLock<T>(purchaseId: string, callback: () => Promise<T>): Promise<T> {
  const scope = getOfflineScope();
  const name = `artha:purchase-finance:${scope.tenant_id}:${scope.store_id}:${purchaseId}`;
  return withInProcessLock(name, () => withCrossTabLock(name, callback));
}
