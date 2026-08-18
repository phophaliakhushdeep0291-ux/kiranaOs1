import { NotebookPen } from "lucide-react";
import type { VerticalPack } from "../types";

/**
 * Furniture & home.
 *
 * The only trade here where the sale usually happens before the goods exist or
 * leave the floor: quote, advance, made-to-order, reserve, deliver, install.
 * That order-driven lifecycle is the reason it is not just "general retail",
 * and the order book is where it lives.
 *
 * An order is NOT a bill. It carries no tax treatment and settles nothing —
 * every other trade's sale is one moment where money and goods change hands, and
 * a bill records exactly that. Here they are weeks apart, so the order holds the
 * promise and links to the bill rung when the goods finally go out.
 *
 * Still to come here: raising that bill from the order in one action rather than
 * two, and a delivery run that groups a day's orders by area.
 */
export const furniturePack: VerticalPack = {
  id: "furniture-home",
  label: "Furniture & Home",
  businessTypes: ["furniture"],
  paths: ["/orders"],
  routes: [
    { path: "/orders", page: "furniture/orders", featureName: "furniture_order_book" },
  ],
  nav: [
    {
      href: "/orders",
      label: "shopType.nav.orderBook",
      Icon: NotebookPen,
      insertAfter: "/billing",
      mobile: { group: "Sell", helper: "shopType.nav.orderBook.helper" },
    },
  ],
  capabilities: [
    "BASIC_INVENTORY", "PRODUCT_VARIANTS", "QUOTATIONS", "SALES_ORDERS",
    "CUSTOM_ORDERS", "ADVANCE_PAYMENTS", "STOCK_RESERVATION", "DELIVERY_ORDERS",
    "INSTALLATION_TRACKING",
  ],
};
