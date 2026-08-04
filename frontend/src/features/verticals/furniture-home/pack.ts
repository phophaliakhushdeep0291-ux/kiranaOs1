import type { VerticalPack } from "../types";

/**
 * Furniture & home.
 *
 * The only trade here where the sale usually happens before the goods exist or
 * leave the floor: quote, advance, made-to-order, reserve, deliver, install.
 * That order-driven lifecycle is the reason it is not just "general retail".
 */
export const furniturePack: VerticalPack = {
  id: "furniture-home",
  label: "Furniture & Home",
  businessTypes: ["furniture"],
  paths: [],
  routes: [],
  nav: [],
  capabilities: [
    "BASIC_INVENTORY", "PRODUCT_VARIANTS", "QUOTATIONS", "SALES_ORDERS",
    "CUSTOM_ORDERS", "ADVANCE_PAYMENTS", "STOCK_RESERVATION", "DELIVERY_ORDERS",
    "INSTALLATION_TRACKING",
  ],
};
