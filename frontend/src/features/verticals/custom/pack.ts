import type { VerticalPack } from "../types";

/**
 * Other / custom.
 *
 * Deliberately the thinnest pack in the app. A shop that does not recognise
 * itself in the other ten gets plain retail and nothing it did not ask for —
 * the specialised behaviour is opt-in, not a default it has to switch off.
 */
export const customPack: VerticalPack = {
  id: "custom",
  label: "Other / Custom",
  businessTypes: ["other"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: ["BASIC_INVENTORY"],
};
