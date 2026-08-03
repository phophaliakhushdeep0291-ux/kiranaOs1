import { defineBusinessProfile, SHARED_RETAIL_NAVIGATION } from "../profile.js";

export default defineBusinessProfile({
  businessType: "other",
  engine: "CONFIGURABLE_RETAIL",
  capabilities: ["BASIC_INVENTORY"],
  navigation: SHARED_RETAIL_NAVIGATION,
});
