import { defineBusinessProfile, SHARED_RETAIL_NAVIGATION } from "../profile.js";

export default defineBusinessProfile({
  businessType: "cosmetics",
  engine: "VARIANT_BATCH_RETAIL",
  capabilities: ["BASIC_INVENTORY", "PRODUCT_VARIANTS", "BATCH_TRACKING", "EXPIRY_TRACKING"],
  navigation: SHARED_RETAIL_NAVIGATION,
});
