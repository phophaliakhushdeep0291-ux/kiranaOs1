import { defineBusinessProfile } from "../profile.js";
import capabilities from "./capabilities.js";
import navigation from "./navigation.js";

export default defineBusinessProfile({
  businessType: "auto_parts",
  engine: "FITMENT_RETAIL",
  capabilities,
  navigation,
});
