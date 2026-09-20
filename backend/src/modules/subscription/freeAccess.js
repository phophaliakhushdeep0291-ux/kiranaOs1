import { env } from "../../config/env.js";

/**
 * Launch promotion: KiranaOS costs nothing until 1 January 2027.
 *
 * Every shop — new, trialling, lapsed or already paying — runs on the full
 * Business plan for the whole window, and no subscription checkout is accepted
 * while it lasts, so nobody is charged for something that is currently free.
 *
 * Nothing is deleted or rewritten to achieve this. Each shop's own subscription
 * row keeps its real status, plan and dates; the promotion is only read on top
 * of it. When the window closes, ordinary plan enforcement resumes on its own
 * from the state that was there all along.
 *
 * The boundary is IST because these are Indian counters, and it comes from
 * FREE_ACCESS_UNTIL so the date can move without a code change. Tests set it to
 * a past instant to exercise the paid enforcement that resumes afterwards.
 */
export const FREE_ACCESS_UNTIL = new Date(env.FREE_ACCESS_UNTIL);

/** The plan every shop is entitled to while the promotion runs. */
export const FREE_ACCESS_PLAN_CODE = "pro";

export function isFreeAccessActive(now = new Date()) {
  return now.getTime() < FREE_ACCESS_UNTIL.getTime();
}

/** The end of the window, for the clients that have to say so on screen. */
export function freeAccessUntilIso() {
  return FREE_ACCESS_UNTIL.toISOString();
}
