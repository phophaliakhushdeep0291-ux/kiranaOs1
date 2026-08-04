import { defineBusinessProfile } from "../profile.js";
import capabilities from "./capabilities.js";
import navigation from "./navigation.js";

export default defineBusinessProfile({
  businessType: "other",
  engine: "CONFIGURABLE_RETAIL",
  capabilities,
  navigation,
});
