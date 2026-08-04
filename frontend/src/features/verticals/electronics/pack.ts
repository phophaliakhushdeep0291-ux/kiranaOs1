import type { VerticalPack } from "../types";

/**
 * Electronics & mobiles.
 *
 * Stock here is not fungible: the shop sells *that* handset, identified by IMEI
 * or serial, and a return or warranty claim has to find the same unit again.
 * That is what separates it from every other trade in the app.
 */
export const electronicsPack: VerticalPack = {
  id: "electronics",
  label: "Electronics & Mobiles",
  businessTypes: ["electronics"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: [
    "BASIC_INVENTORY", "SERIAL_TRACKING", "IMEI_TRACKING", "WARRANTY_TRACKING",
    "REPAIR_TICKETS", "OPEN_BOX_STOCK",
  ],
};
