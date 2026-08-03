/**
 * Compatibility facade.
 *
 * Business profiles are owned by `src/verticals/<shop-type>/profile.js`.
 * Shop/auth modules import this stable path so the structural refactor does not
 * couple shared core code to every individual vertical.
 */
export * from "../../verticals/registry.js";
