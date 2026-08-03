import { defineBusinessProfile, SHARED_RETAIL_NAVIGATION } from "../profile.js";

export default defineBusinessProfile({
  businessType: "furniture",
  engine: "ORDER_RETAIL",
  capabilities: ["BASIC_INVENTORY", "QUOTATIONS", "DELIVERY_ORDERS", "PRODUCT_VARIANTS"],
  navigation: [...SHARED_RETAIL_NAVIGATION, "quotations", "delivery"],
});
