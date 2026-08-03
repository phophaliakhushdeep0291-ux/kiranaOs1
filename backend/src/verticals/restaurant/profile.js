import { defineBusinessProfile } from "../profile.js";

export default defineBusinessProfile({
  businessType: "restaurant",
  engine: "RESTAURANT",
  capabilities: ["TABLE_MANAGEMENT", "KOT", "RECIPE_INVENTORY", "DELIVERY_ORDERS"],
  navigation: ["dashboard", "pos", "tables", "orders", "kitchen-kot", "menu", "inventory", "customers", "delivery", "reports", "expenses"],
});
