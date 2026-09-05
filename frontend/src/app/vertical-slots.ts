import type { VerticalPack, VerticalSlotId } from "@/features/verticals/registry";

/**
 * The dynamic imports behind the slots a pack declares.
 *
 * Lives in `app/` for the same reason `VERTICAL_PAGES` does: `features/core` may
 * never import a pack, and a pack may not import its own control either —
 * `pack.ts` is startup code for every shop, whatever its trade, so an import
 * there ships one trade's UI to all eleven.
 *
 * `Record<VerticalSlotId, ...>` makes the compiler reject a slot a pack names
 * and nobody wired up.
 */
const VERTICAL_SLOTS: Record<VerticalSlotId, () => Promise<unknown>> = {
  "pharmacy/prescription": () => import("@/features/verticals/pharmacy/prescriptions/billing-slot"),
  "pharmacy/schedule-slip": () => import("@/features/verticals/pharmacy/prescriptions/billing-schedule-check"),
  "restaurant/addons": () => import("@/features/verticals/restaurant/billing-addon-configurator"),
  "restaurant/unfired-kot": () => import("@/features/verticals/restaurant/billing-unfired-kot-check"),
};

/**
 * Register the active pack's controls. Importing the module is what registers it.
 *
 * Called once at startup rather than when billing opens, so the control is in
 * place before the first Schedule H medicine is scanned or the first dish with
 * add-ons is tapped — a pharmacy or restaurant is already fetching its own
 * screens for its routes, so this costs it no extra request, and costs every
 * other trade nothing at all.
 *
 * Failures are swallowed deliberately: a control that will not load must not
 * stop the till from selling. For prescriptions the server-side guard still
 * refuses the sale it should refuse (`backend/src/shared/sale-guards.js`), so
 * the shop is never left quietly selling something it may not; a dish whose
 * add-on dialog is missing is simply added plain, which is the same outcome as
 * a dish that has no add-ons.
 *
 * Returns the pending registrations. The app fires and forgets; tests await,
 * since "did the control register at all?" is otherwise a silent failure.
 */
export function loadVerticalSlots(pack: VerticalPack): Promise<void> {
  const pending = (pack.billingSlots ?? []).map((slotId) =>
    VERTICAL_SLOTS[slotId]?.().catch(() => undefined),
  );
  return Promise.all(pending).then(() => undefined);
}
