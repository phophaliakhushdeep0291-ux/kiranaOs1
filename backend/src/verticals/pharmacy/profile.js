import { defineBusinessProfile } from "../profile.js";

export default defineBusinessProfile({
  businessType: "pharmacy",
  engine: "BATCH_RETAIL",
  capabilities: ["BASIC_INVENTORY", "BATCH_TRACKING", "EXPIRY_TRACKING"],
  navigation: ["dashboard", "billing", "medicines", "batches", "expiry", "purchases", "customers", "prescriptions", "returns", "reports"],
});
