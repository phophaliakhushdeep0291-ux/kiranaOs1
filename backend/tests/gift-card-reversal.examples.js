import test from "node:test";
import assert from "node:assert/strict";
import { reapplyGiftCardRedemptions, reverseGiftCardRedemptions } from "../src/modules/gift-cards/giftCards.service.js";

/**
 * Cancelling a bill re-armed a gift card the shop had blocked.
 *
 * A gift card holds real customer money, so a shop can disable one: reported
 * lost, stolen, or withdrawn after a dispute. Disabling refuses it at the till
 * from that moment on.
 *
 * Cancelling a bill it had paid for put the value back and set the card to
 * "active" unconditionally. Whoever was holding a blocked card could spend it
 * again — and the reversal is the one moment the card is guaranteed to be
 * carrying a balance, because it has just been handed its money back.
 *
 * The value still goes back; only the status is left alone. The gift-card
 * ledger must keep adding up against its own transactions whether the card can
 * be spent or not.
 *
 * These are the first tests over this module, so they also pin the two rules the
 * reversal path relies on: it is skipped once a bill has already been reversed,
 * and re-applying a restored bill still refuses a blocked card.
 */

function mockTx({ cards, transactions }) {
  const cardRows = cards.map((row) => ({ ...row }));
  const transactionRows = transactions.map((row) => ({ ...row }));
  const written = [];
  const tx = {
    giftCardTransaction: {
      findMany: async ({ where }) => transactionRows.filter((row) => row.shopId === where.shopId && row.billId === where.billId),
      create: async ({ data }) => {
        written.push(data);
        transactionRows.push(data);
        return data;
      },
    },
    giftCard: {
      findUnique: async ({ where }) => cardRows.find((row) => row.id === where.id) ?? null,
      update: async ({ where, data }) => {
        const row = cardRows.find((entry) => entry.id === where.id);
        if (data.balancePaise?.increment !== undefined) row.balancePaise += data.balancePaise.increment;
        if (data.balancePaise?.decrement !== undefined) row.balancePaise -= data.balancePaise.decrement;
        if (data.status) row.status = data.status;
        return row;
      },
      updateMany: async () => ({ count: 1 }),
    },
  };
  return { tx, cardRows, written };
}

/** One card, spent down to nothing on one bill. */
function spentOnOneBill(status) {
  return mockTx({
    cards: [{ id: "card-1", codeLast4: "4242", balancePaise: 0n, status }],
    transactions: [{
      shopId: "shop-1", billId: "bill-1", giftCardId: "card-1", locationId: "location-1",
      type: "redeem", amountPaise: -50000n, balanceAfterPaise: 0n,
    }],
  });
}

test("a blocked card gets its value back but stays blocked", async () => {
  const { tx, cardRows, written } = spentOnOneBill("disabled");

  await reverseGiftCardRedemptions(tx, "shop-1", "bill-1", { note: "Bill cancelled" });

  assert.equal(cardRows[0].balancePaise, 50000n, "the money still has to go back to the card");
  assert.equal(cardRows[0].status, "disabled", "cancelling a bill must not re-arm a card the shop blocked");
  assert.equal(written.length, 1, "and the reversal is recorded either way");
  assert.ok(written[0].type.startsWith("redemption_reversal_"));
  assert.equal(written[0].amountPaise, 50000n);
});

test("a card emptied by the sale becomes spendable again", async () => {
  const { tx, cardRows } = spentOnOneBill("depleted");

  await reverseGiftCardRedemptions(tx, "shop-1", "bill-1", {});

  assert.equal(cardRows[0].balancePaise, 50000n);
  assert.equal(cardRows[0].status, "active", "a card that only ran out is fine again once its value returns");
});

test("a bill already reversed is not reversed twice", async () => {
  const { tx, cardRows, written } = mockTx({
    cards: [{ id: "card-1", codeLast4: "4242", balancePaise: 50000n, status: "active" }],
    transactions: [
      { shopId: "shop-1", billId: "bill-1", giftCardId: "card-1", type: "redeem", amountPaise: -50000n },
      { shopId: "shop-1", billId: "bill-1", giftCardId: "card-1", type: "redemption_reversal_1", amountPaise: 50000n },
    ],
  });

  await reverseGiftCardRedemptions(tx, "shop-1", "bill-1", {});

  assert.equal(cardRows[0].balancePaise, 50000n, "a replayed cancel must not pay the card twice");
  assert.deepEqual(written, []);
});

test("restoring a cancelled bill will not take money from a blocked card", async () => {
  const { tx, cardRows } = mockTx({
    cards: [{ id: "card-1", codeLast4: "4242", balancePaise: 50000n, status: "disabled" }],
    transactions: [
      { shopId: "shop-1", billId: "bill-1", giftCardId: "card-1", locationId: "location-1", type: "redeem", amountPaise: -50000n },
      { shopId: "shop-1", billId: "bill-1", giftCardId: "card-1", locationId: "location-1", type: "redemption_reversal_1", amountPaise: 50000n },
    ],
  });

  await assert.rejects(
    reapplyGiftCardRedemptions(tx, "shop-1", "bill-1", {}),
    (error) => error?.code === "GIFT_CARD_RESTORE_UNAVAILABLE",
  );
  assert.equal(cardRows[0].balancePaise, 50000n, "and the balance is left exactly as it was");
});
