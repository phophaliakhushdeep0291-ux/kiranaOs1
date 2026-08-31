import { offlineDB } from "@/lib/offline/db";
import { activateWaitingServiceWorker } from "./registerServiceWorker";

/**
 * Apply a waiting update by itself, but only when the counter is quiet.
 *
 * The service worker installs a new build and then waits, because activating it
 * swaps the JS under a running app: `deleteOldShellCaches` drops the previous
 * build's chunks, so a lazy import the shopkeeper triggers a second later can
 * 404. On a till that is mid-bill, that is the worst possible moment.
 *
 * So the existing design asks first — a toast with "Refresh now". The gap is
 * that nobody has to answer it. A tab open since before the deploy keeps serving
 * yesterday's build indefinitely, and the shopkeeper's honest report is "you did
 * not fix it". That is not a hypothetical: it is how a fix that shipped, tested
 * and deployed still was not on the screen.
 *
 * This closes the gap without taking the risk the prompt exists to avoid: the
 * update is applied on its own the moment the shop is demonstrably not in the
 * middle of anything, and the prompt remains for every other moment.
 */

/** Long enough that a pause between customers is not mistaken for one. */
const IDLE_BEFORE_UPDATE_MS = 30_000;
const SAFETY_POLL_MS = 15_000;
const BILLING_DRAFT_KEY = "kirana-os:billing-draft:v1";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart"] as const;

/** What the predicate needs to know, so the policy can be tested without a DOM. */
export interface CounterState {
  /** Items on the bill in progress, or null when the draft could not be read. */
  cartItemCount: number | null;
  pathname: string;
  modalOpen: boolean;
}

/**
 * Is there anything on screen that an update would interrupt?
 *
 * Deliberately pessimistic: every uncertain answer is "busy". Waiting another
 * fifteen seconds costs nothing, and guessing wrong costs a bill. Kept pure so
 * the one risky decision in this file is testable on its own — this suite has no
 * DOM, and a predicate this consequential should not go untested for that.
 */
export function counterIsBusy(state: CounterState): boolean {
  // Unreadable storage is not an empty cart. Claiming "quiet" here would reload
  // the app over a bill in progress.
  if (state.cartItemCount === null || state.cartItemCount > 0) return true;
  // The till itself, even with an empty cart — a barcode scan is one beep away.
  if (state.pathname.startsWith("/billing")) return true;
  // Anything modal is a decision in progress: a payment, an owner PIN, a confirm.
  if (state.modalOpen) return true;
  return false;
}

async function readCounterState(): Promise<CounterState> {
  // The draft is read from storage rather than React state: this runs outside the
  // billing screen's tree, and the draft is the record that survives a reload.
  let cartItemCount: number | null = null;
  try {
    const draft = await offlineDB.getSetting<{ cart?: unknown[] }>(BILLING_DRAFT_KEY);
    cartItemCount = Array.isArray(draft?.cart) ? draft.cart.length : 0;
  } catch {
    cartItemCount = null;
  }
  return {
    cartItemCount,
    pathname: window.location.pathname,
    modalOpen: Boolean(document.querySelector('[role="dialog"], [aria-modal="true"]')),
  };
}

async function shopIsBusy(): Promise<boolean> {
  if (typeof document === "undefined") return true;
  return counterIsBusy(await readCounterState());
}

/**
 * Start watching for a safe moment. Returns a stop function.
 *
 * Called once an update is known to be waiting; before that there is nothing to
 * apply and no reason to hold listeners.
 */
export function applyUpdateWhenIdle(): () => void {
  if (typeof window === "undefined") return () => {};

  let lastActivity = Date.now();
  let stopped = false;
  const markActive = () => { lastActivity = Date.now(); };
  for (const event of ACTIVITY_EVENTS) window.addEventListener(event, markActive, { passive: true });

  const attempt = async () => {
    if (stopped) return;
    // A hidden tab is the best possible moment: nobody is looking at it, and the
    // reload finishes before they come back.
    const idleEnough = document.visibilityState === "hidden"
      || Date.now() - lastActivity >= IDLE_BEFORE_UPDATE_MS;
    if (!idleEnough) return;
    if (await shopIsBusy()) return;
    stop();
    activateWaitingServiceWorker();
  };

  const timer = window.setInterval(() => void attempt(), SAFETY_POLL_MS);
  const onHidden = () => { if (document.visibilityState === "hidden") void attempt(); };
  document.addEventListener("visibilitychange", onHidden);

  function stop() {
    if (stopped) return;
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener("visibilitychange", onHidden);
    for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, markActive);
  }

  // One early attempt: an update found on a screen nobody is using should not
  // wait a full poll interval to be taken.
  void attempt();
  return stop;
}

export const __autoUpdateInternals = { shopIsBusy, IDLE_BEFORE_UPDATE_MS, SAFETY_POLL_MS };
