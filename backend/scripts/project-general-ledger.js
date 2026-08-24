import db from "../src/db.js";
import { projectShopGeneralLedger } from "../src/modules/finance/general-ledger.service.js";

const shops = await db.shop.findMany({ select: { id: true, name: true } });
const results = [];
for (const shop of shops) results.push({ name: shop.name, ...await projectShopGeneralLedger(shop.id) });
const summary = { shops: shops.length, journalsCreated: results.reduce((sum, row) => sum + row.journalsCreated, 0), journalsExisting: results.reduce((sum, row) => sum + row.journalsExisting, 0) };
console.log(JSON.stringify(process.argv.includes("--verbose") ? { ...summary, results } : summary, null, 2));
await db.$disconnect();
