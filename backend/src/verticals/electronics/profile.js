import { defineBusinessProfile } from "../profile.js";
import capabilities from "./capabilities.js";
import navigation from "./navigation.js";
import assistant from "./assistant.js";

export default defineBusinessProfile({
  businessType: "electronics",
  engine: "SERIALIZED_RETAIL",
  capabilities,
  navigation,
  assistant,
});
