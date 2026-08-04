import { defineBusinessProfile } from "../profile.js";
import capabilities from "./capabilities.js";
import navigation from "./navigation.js";

export default defineBusinessProfile({
  businessType: "furniture",
  engine: "ORDER_RETAIL",
  capabilities,
  navigation,
});
