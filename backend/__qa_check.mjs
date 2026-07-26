import { writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
const L = [];
const shop = (await p.shop.findMany({ where: { name: "Prod Readiness QA" }, orderBy: { createdAt: "desc" }, take: 1 }))[0];
if (!shop) { L.push("no shop"); }
else {
  const bills = await p.bill.findMany({ where: { shopId: shop.id }, include: { items: true, payments: true }, orderBy: { createdAt: "asc" } });
  for (const b of bills) {
    L.push(`BILL ${b.billNo} type=${b.billType} subtotal=${b.subtotal} gst=${b.gst} gstMode=${b.gstMode} total=${b.grandTotal} paid=${b.paidAmount} credit=${b.creditAmount} profit=${b.grossProfit}`);
    for (const i of b.items) L.push(`   ${i.name} qty=${i.quantity} rate=${i.ratePerRateUnit} gstRate=${i.gstRate} lineTotal=${i.lineTotal} lineProfit=${i.lineProfit}`);
  }
  const prods = await p.product.findMany({ where: { shopId: shop.id }, select: { name: true, stockBaseQty: true } });
  L.push("STOCK: " + JSON.stringify(prods));
}
await p.$disconnect();
writeFileSync("__qa_out.txt", L.join("\n") + "\n");
