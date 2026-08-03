import { defineBusinessProfile } from "../profile.js";

export default defineBusinessProfile({
  businessType: "electronics",
  engine: "SERIALIZED_RETAIL",
  capabilities: ["BASIC_INVENTORY", "SERIAL_TRACKING", "WARRANTY_TRACKING"],
  navigation: ["dashboard", "billing", "products", "serial-numbers", "inventory", "warranty", "purchases", "returns", "reports"],
});
