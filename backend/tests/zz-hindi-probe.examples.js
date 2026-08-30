/** Temporary Hindi probe — deleted after running. */
import db from "../src/db.js";
import { runAgentTurn } from "../src/modules/ai/agent/agent.service.js";
import "../src/modules/ai/agent/register-core.js";

const shop = await db.shop.create({
  data: { name: "Hindi Kirana", ownerName: "Owner", city: "Indore", address: "Test" },
});
for (const data of [
  { name: "Sugar", baseUnit: "kg", rateUnit: "kg", defaultPricePerRateUnit: 42, costPerRateUnit: 38, stockBaseQty: 2, lowStockThreshold: 10 },
  { name: "Mustard Oil", baseUnit: "ltr", rateUnit: "ltr", defaultPricePerRateUnit: 180, costPerRateUnit: 160, stockBaseQty: 40, lowStockThreshold: 5 },
  { name: "Basmati Rice", baseUnit: "kg", rateUnit: "kg", defaultPricePerRateUnit: 95, costPerRateUnit: 80, stockBaseQty: 3, lowStockThreshold: 15 },
]) await db.product.create({ data: { shopId: shop.id, ...data } });
await db.customer.create({ data: { shopId: shop.id, name: "Ramesh Kumar", mobile: "9876543210" } });

const ctx = { shopId: shop.id, userId: null, role: "owner", deviceId: null, businessType: "kirana" };

const DEVANAGARI = /[ऀ-ॿ]/;

async function ask(label, message, language) {
  try {
    const turn = await runAgentTurn(ctx, { message, language });
    const reply = (turn.reply || "").replace(/\s+/g, " ");
    console.log(`\n--- ${label}  [lang=${language}]`);
    console.log("  asked :", message);
    console.log("  reply :", reply.slice(0, 320));
    console.log("  script:", DEVANAGARI.test(reply) ? "Devanagari" : "Roman");
    console.log("  tools :", turn.trace.map((s) => `${s.tool}:${s.status}`).join(" > ") || "none");
    if (turn.plan.length) console.log("  plan  :", turn.plan.map((p) => p.summary).join(" | "));
  } catch (error) {
    console.log(`\n--- ${label}\n  ERROR: ${error?.message}`);
  }
}

console.log("\n===== DEVANAGARI IN =====");
await ask("stock question", "चीनी कितनी बची है?", "hi");
await ask("reorder", "क्या क्या मंगवाना है?", "hi");
await ask("price change", "चीनी का रेट 48 कर दो", "hi");

console.log("\n===== ROMAN HINGLISH IN =====");
await ask("stock question", "chini kitni bachi hai?", "hi");
await ask("udhar", "Ramesh ka udhar kitna hai?", "hi");

console.log("\n===== ENGLISH IN, HINDI SHOP =====");
await ask("stock question", "how much sugar is left?", "hi");

console.log("\n===== ENGLISH SHOP =====");
await ask("stock question", "how much sugar is left?", "en");

await db.$disconnect();
console.log("\nzz-hindi-probe.examples.js OK");
