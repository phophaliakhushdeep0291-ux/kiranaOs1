import { defineBusinessProfile } from "../profile.js";

export default defineBusinessProfile({
  businessType: "clothing",
  engine: "VARIANT_RETAIL",
  capabilities: ["BASIC_INVENTORY", "PRODUCT_VARIANTS", "QUOTATIONS"],
  navigation: ["dashboard", "billing", "products", "variants", "inventory", "customers", "purchases", "exchanges", "rentals", "sales", "reports"],
});
