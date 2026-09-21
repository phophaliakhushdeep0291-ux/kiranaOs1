import { env } from "../../config/env.js";
import {
  BUSINESS_TYPE_PLAN_PRICING,
  getPlanConfigForBusinessType,
  PLAN_CODES,
} from "./planConfig.js";

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

/** The plan code every shop holds while the promotion runs. */
export const FREE_ACCESS_PLAN_CODE = "pro";

// Every plan the product sells, in every trade. Fixed for the life of the process.
const EVERY_PLAN = PLAN_CODES.flatMap((code) =>
  Object.keys(BUSINESS_TYPE_PLAN_PRICING).map((businessType) => getPlanConfigForBusinessType(code, businessType)),
);
const EVERY_FEATURE = [...new Set(EVERY_PLAN.flatMap((plan) => plan.features))];
const highest = (limit) => Math.max(...EVERY_PLAN.map((plan) => plan[limit]));

/**
 * What a shop is entitled to while the promotion runs: the whole product.
 *
 * Its own trade's top plan was not enough. That left every other trade's features
 * locked, and any shop can switch those modules on — a grocer turning on rentals,
 * a hardware shop the part finder — only to meet an upgrade it could not buy. It
 * also held a grocer to 3 stores and 10 staff. So the window grants every feature
 * any plan grants in any trade, and the highest device, staff and store limits
 * any plan allows. The name and price stay the trade's own top plan's, because
 * that is what the screens call it.
 */
export function freeAccessPlan(businessType) {
  return {
    ...getPlanConfigForBusinessType(FREE_ACCESS_PLAN_CODE, businessType),
    features: [...EVERY_FEATURE],
    maxDevices: highest("maxDevices"),
    maxStaff: highest("maxStaff"),
    maxStores: highest("maxStores"),
  };
}

export function isFreeAccessActive(now = new Date()) {
  return now.getTime() < FREE_ACCESS_UNTIL.getTime();
}

/** The end of the window, for the clients that have to say so on screen. */
export function freeAccessUntilIso() {
  return FREE_ACCESS_UNTIL.toISOString();
}
