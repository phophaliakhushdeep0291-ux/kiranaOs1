import { defineBusinessProfile, SHARED_RETAIL_NAVIGATION } from "../profile.js";

export default defineBusinessProfile({
  businessType: "auto_parts",
  engine: "FITMENT_RETAIL",
  capabilities: ["BASIC_INVENTORY", "VEHICLE_FITMENT", "QUOTATIONS", "WARRANTY_TRACKING"],
  navigation: [...SHARED_RETAIL_NAVIGATION, "quotations"],
});
