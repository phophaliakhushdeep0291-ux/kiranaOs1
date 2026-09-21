/**
 * Whether this process has already seen the Plan table agree with PLAN_CONFIGS.
 *
 * Its own module, and deliberately one with no imports at all, because
 * tests/integration/setup.js has to clear this after it truncates Plan. Importing
 * subscription.service.js there would pull src/db.js into the module graph, and
 * db.js reads DATABASE_URL at import time — before setup.js's own
 * `Object.assign(process.env, buildTestEnv())` runs, since imports are hoisted
 * above it. It would then refuse to load, against the shared development
 * database, and take the whole integration suite with it.
 *
 * Why memoise at all: the catalogue is seeded by server.js at boot and compared
 * against a compile-time constant, so after one clean comparison a later request
 * cannot learn anything new. Before this, every gated request re-read every Plan
 * row and diffed eight fields — and getEffectivePlan is on the sync pull path, so
 * that was once per device per pull.
 */
let verified = false;

export function isPlanCatalogueVerified() {
  return verified;
}

export function markPlanCatalogueVerified() {
  verified = true;
}

/** For tests that delete plan rows mid-process. Production never removes them. */
export function forgetVerifiedPlanCatalogue() {
  verified = false;
}
