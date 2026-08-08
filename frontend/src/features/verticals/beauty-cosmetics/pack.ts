import { Sparkles } from "lucide-react";
import type { VerticalPack } from "../types";

/**
 * Beauty & cosmetics.
 *
 * Shade is a variant axis, and stock is dated — which is why this trade carries
 * `BATCH_TRACKING`/`EXPIRY_TRACKING` alongside pharmacy and kirana, and why
 * neither of those belongs to any single vertical.
 *
 * Testers are what is exclusive here. A tester is a unit opened for customers to
 * try and will never be sold, so counted as sellable it makes the shelf wrong in
 * three ways at once: the shop believes it has stock it does not, the missing
 * units surface weeks later as shrinkage that looks like theft, and a real line
 * of spending stays invisible. Opening one therefore moves stock out through
 * core's ordinary inventory path — a register that did not would leave the
 * original problem exactly where it was.
 *
 * Bundles and loyalty are deliberately NOT here: both are shared with other
 * trades (`core/loyalty` already serves this shop), and shared behaviour belongs
 * in core rather than in one pack.
 */
export const cosmeticsPack: VerticalPack = {
  id: "beauty-cosmetics",
  label: "Beauty & Cosmetics",
  businessTypes: ["cosmetics"],
  paths: ["/testers"],
  routes: [
    { path: "/testers", page: "cosmetics/testers", featureName: "tester_stock" },
  ],
  nav: [
    {
      href: "/testers",
      label: "Testers",
      Icon: Sparkles,
      insertAfter: "/inventory",
      mobile: { group: "Stock & buying", helper: "What is open on the counter, and what it costs" },
    },
  ],
  capabilities: [
    "BASIC_INVENTORY", "PRODUCT_VARIANTS", "BATCH_TRACKING", "EXPIRY_TRACKING",
    "TESTER_STOCK", "LOYALTY", "PRODUCT_BUNDLES",
  ],
};
