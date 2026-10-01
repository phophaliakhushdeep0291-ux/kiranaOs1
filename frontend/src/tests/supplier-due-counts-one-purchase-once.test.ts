import { describe, expect, it } from "vitest";
import { aggregateFinancialRows } from "@/features/core/finance/services/FinancialAggregationService";

/**
 * One purchase must appear on the day-close screen once.
 *
 * Found by using the app: record a single ₹480 purchase bill on full credit, then
 * open Daily Closing. "Supplier due (unpaid) — Purchase bills not yet paid" read
 * **₹960**. There was exactly one bill in the local database.
 *
 * A purchase writes two local rows: the bill itself, and the stock movement that
 * received the goods. `buildSupplierDueRows` reads both tables on purpose — an
 * older or partially-synced shop may have only one of them — and then dedupes.
 * The dedupe had nothing to match on:
 *
 *   - the movement names its bill through `sourceId`, which the identity keys
 *     did not read;
 *   - the bill carries `supplierId` and no `productId`, the movement the exact
 *     reverse, so the supplier/product fallback keys differ;
 *   - the amount sits in `billAmount` on one and `purchaseBillAmount` on the other.
 *
 * So both survived and the owner's closing figure doubled. These are the exact
 * row shapes the app produced, trimmed to the fields the dedupe reads.
 */

const DATE = "2026-09-20";
const BILL_ID = "cmu9qxw7006rzpy14y7vc529g";

const purchaseBill = {
  id: BILL_ID,
  server_id: BILL_ID,
  supplierId: "cmu9qwvgz06qzpy14q05mwt0e",
  supplierName: "Agarwal Distributors",
  billAmount: 480,
  invoiceNumber: "AGD-5521",
  purchasePaidAmount: 0,
  purchaseDueAmount: 480,
  createdAt: `${DATE}T11:42:07.161Z`,
  created_at: `${DATE}T11:42:07.161Z`,
};

const receivingMovement = {
  id: "cmu9qxw7106s1py142zdgaugn",
  local_id: "cmu9qxw7106s1py142zdgaugn",
  server_id: "cmu9qxw7106s1py142zdgaugn",
  type: "purchase",
  sourceType: "purchase",
  sourceId: BILL_ID,
  productId: "cmu9qaccw03a3py141ztak5gb",
  supplierName: "Agarwal Distributors",
  purchaseBillAmount: 480,
  invoiceNumber: "AGD-5521",
  purchasePaidAmount: 0,
  purchaseDueAmount: 480,
  createdAt: `${DATE}T11:42:07.161Z`,
  created_at: `${DATE}T11:42:07.161Z`,
};

const aggregate = (input: Record<string, unknown>) => aggregateFinancialRows({
  date: DATE,
  bills: [],
  billItems: [],
  payments: [],
  ledger: [],
  products: [],
  customers: [],
  suppliers: [],
  inventoryMovements: [],
  purchaseBills: [],
  ...input,
} as never);

describe("supplier due on the day-close screen", () => {
  it("counts a purchase once when both its bill and its receiving movement are present", () => {
    const snapshot = aggregate({
      purchaseBills: [purchaseBill],
      inventoryMovements: [receivingMovement],
    });
    expect(snapshot.purchaseDueToday).toBe(480);
    expect(snapshot.supplierDueRows).toHaveLength(1);
  });

  it("keeps the bill, not the movement, since the bill is the document", () => {
    const snapshot = aggregate({
      purchaseBills: [purchaseBill],
      inventoryMovements: [receivingMovement],
    });
    expect(snapshot.supplierDueRows[0]).toMatchObject({
      source: "purchase_bill",
      invoiceNumber: "AGD-5521",
      due: 480,
    });
  });

  it("still reports a shop that only has the movement", () => {
    // An older or partially-synced shop may have the receiving movement and no
    // bill row. Dropping it would understate what is owed, which is why the
    // aggregation reads both tables rather than just the bills.
    const snapshot = aggregate({ inventoryMovements: [receivingMovement] });
    expect(snapshot.purchaseDueToday).toBe(480);
  });

  it("still reports a shop that only has the bill", () => {
    const snapshot = aggregate({ purchaseBills: [purchaseBill] });
    expect(snapshot.purchaseDueToday).toBe(480);
  });

  it("does not collapse two genuinely different purchases from one supplier", () => {
    const second = { ...purchaseBill, id: "second-bill", server_id: "second-bill", invoiceNumber: "AGD-5522", billAmount: 250, purchaseDueAmount: 250 };
    const snapshot = aggregate({ purchaseBills: [purchaseBill, second] });
    expect(snapshot.purchaseDueToday).toBe(730);
    expect(snapshot.supplierDueRows).toHaveLength(2);
  });

  it("never lets a non-purchase movement borrow a purchase identity", () => {
    // `sourceId` on a damage or sale movement points at something else entirely;
    // reading it unguarded would merge unrelated rows.
    const damage = { ...receivingMovement, id: "damage-1", local_id: "damage-1", server_id: "damage-1", type: "damage", sourceType: "manual_damage" };
    const snapshot = aggregate({ purchaseBills: [purchaseBill], inventoryMovements: [damage] });
    expect(snapshot.purchaseDueToday).toBe(480);
  });
});
