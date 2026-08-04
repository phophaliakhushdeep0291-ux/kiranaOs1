import { defineBusinessProfile } from "../profile.js";
import capabilities from "./capabilities.js";
import navigation from "./navigation.js";

export default defineBusinessProfile({
  businessType: "footwear",
  engine: "VARIANT_RETAIL",
  capabilities,
  navigation,
});
