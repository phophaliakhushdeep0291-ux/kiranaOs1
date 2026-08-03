import { defineBusinessProfile } from "../profile.js";

export default defineBusinessProfile({
  businessType: "footwear",
  engine: "VARIANT_RETAIL",
  capabilities: ["BASIC_INVENTORY", "PRODUCT_VARIANTS"],
  navigation: ["dashboard", "billing", "products", "variants", "inventory", "customers", "purchases", "exchanges", "sales", "reports"],
});
