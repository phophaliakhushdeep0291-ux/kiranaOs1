import db from "../src/db.js";
import { calculateCustomerUdharBalance, syncCustomerUdharBalance } from "../src/modules/udhar/udharBalance.service.js";

async function main() {
  const shopIdArg = process.argv.find((arg) => arg.startsWith("--shopId="));
  const shopId = shopIdArg ? shopIdArg.slice("--shopId=".length) : null;

  const customers = await db.customer.findMany({
    where: {
      deletedAt: null,
      ...(shopId ? { shopId } : {}),
    },
    select: { id: true, shopId: true, name: true, udharAmount: true },
  });

  let repaired = 0;
  let synced = 0;
  for (const customer of customers) {
    await db.$transaction(async (tx) => {
      const before = await calculateCustomerUdharBalance(tx, customer.shopId, customer.id);
      const result = await syncCustomerUdharBalance(tx, customer.shopId, customer.id, {
        repairNegative: true,
        repairNote: `One-time production repair: negative udhar ledger corrected for ${customer.name}`,
      });
      if (before.isNegative) repaired += 1;
      if (Number(customer.udharAmount ?? 0) !== result.balance || before.isNegative) synced += 1;
      console.log(`${customer.shopId} ${customer.id} ${customer.name}: cached=${customer.udharAmount} raw=${before.rawBalance} final=${result.balance}${before.isNegative ? " repaired" : ""}`);
    });
  }

  console.log(`Udhar repair completed. Customers checked=${customers.length}, synced=${synced}, negativeRepaired=${repaired}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
