import { defineBusinessProfile } from "../profile.js";
import capabilities from "./capabilities.js";
import navigation from "./navigation.js";

export default defineBusinessProfile({
  businessType: "cosmetics",
  engine: "VARIANT_BATCH_RETAIL",
  capabilities,
  navigation,
});
