import { defineBusinessProfile, SHARED_RETAIL_NAVIGATION } from "../profile.js";

export default defineBusinessProfile({
  businessType: "stationery",
  engine: "RETAIL",
  capabilities: ["BASIC_INVENTORY", "LOOSE_ITEMS", "QUOTATIONS"],
  navigation: SHARED_RETAIL_NAVIGATION,
});
