import { Factory } from "lucide-react";
import type { VerticalPack } from "../types";

export const manufacturingPack: VerticalPack = {
  id: "manufacturing",
  label: "Manufacturing, Wholesale & Export",
  businessTypes: ["manufacturing"],
  paths: ["/manufacturing"],
  routes: [{ path: "/manufacturing", page: "manufacturing/operations" }],
  nav: [{
    href: "/manufacturing",
    label: "Manufacturing",
    Icon: Factory,
    insertAfter: "/inventory",
    mobile: { group: "Operations", helper: "BOMs, production, packaging, batches and export dispatch" },
  }],
  capabilities: [
    "BASIC_INVENTORY", "PACK_CONVERSION", "BATCH_TRACKING", "EXPIRY_TRACKING",
    "SUPPLIER_RETURNS", "WHOLESALE_PRICING", "SALES_ORDERS", "DELIVERY_ORDERS",
    "BOM", "PRODUCTION_RUNS", "BATCH_GENEALOGY", "PACKAGING_SKUS",
    "QUALITY_CONTROL", "WASTAGE_TRACKING", "WHOLESALE_ORDERS", "EXPORT_DOCUMENTS",
  ],
};
