import { defineBusinessProfile } from "../profile.js";

export default defineBusinessProfile({
  businessType: "kirana",
  engine: "RETAIL",
  capabilities: ["BASIC_INVENTORY", "LOOSE_ITEMS", "UDHAR", "BATCH_TRACKING", "EXPIRY_TRACKING"],
  navigation: ["dashboard", "billing", "inventory", "customers", "purchases", "sales", "returns", "reports", "cash-payments", "expenses"],
});
