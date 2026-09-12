import { beforeEach, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({
  value: null as unknown,
  failRead: false,
  failWrite: false,
  tail: Promise.resolve() as Promise<unknown>,
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: async () => {
      if (storage.failRead) throw new Error("Read failed");
      return structuredClone(storage.value);
    },
    setSetting: async (_key: string, value: unknown) => {
      if (storage.failWrite) throw new Error("Write failed");
      storage.value = structuredClone(value);
    },
    // Model IndexedDB's serialized read/write transactions and rollback.
    transaction: async (_stores: string[], work: (tx: { setSetting: (key: string, value: unknown) => Promise<void> }) => Promise<unknown>) => {
      const result = storage.tail.then(async () => {
        const before = structuredClone(storage.value);
        try {
          return await work({ setSetting: async (_key, value) => {
            if (storage.failWrite) throw new Error("Write failed");
            storage.value = structuredClone(value);
          } });
        } catch (error) {
          storage.value = before;
          throw error;
        }
      });
      storage.tail = result.catch(() => undefined);
      return result;
    },
  },
}));

import { stageBillLines, takeStagedBillLines } from "@/features/core/billing/assistant-staging";

const soap = { productId: "soap", name: "Soap", quantity: 2, unit: "piece", rate: 50 };
const shampoo = { productId: "shampoo", name: "Shampoo", quantity: 1, unit: "bottle", rate: 100 };

beforeEach(() => {
  storage.value = null;
  storage.failRead = false;
  storage.failWrite = false;
  storage.tail = Promise.resolve();
});

it("preserves both concurrent additions", async () => {
  await Promise.all([stageBillLines([soap]), stageBillLines([shampoo])]);
  expect(await takeStagedBillLines()).toEqual([soap, shampoo]);
});

it("gives queued items to only one concurrent reader", async () => {
  await stageBillLines([soap]);
  const results = await Promise.all([takeStagedBillLines(), takeStagedBillLines()]);
  expect(results.flat()).toEqual([soap]);
  expect(results.filter((lines) => lines.length)).toHaveLength(1);
});

it("does not deliver items when clearing fails, and preserves them for retry", async () => {
  await stageBillLines([soap]);
  storage.failWrite = true;
  await expect(takeStagedBillLines()).rejects.toThrow("Write failed");
  storage.failWrite = false;
  expect(await takeStagedBillLines()).toEqual([soap]);
});

it("does not overwrite queued items when reading them fails", async () => {
  await stageBillLines([soap]);
  storage.failRead = true;
  await expect(stageBillLines([shampoo])).rejects.toThrow("Read failed");
  storage.failRead = false;
  expect(await takeStagedBillLines()).toEqual([soap]);
});

it("leaves items queued when the billing screen has gone away", async () => {
  await stageBillLines([soap]);
  expect(await takeStagedBillLines(() => false)).toEqual([]);
  expect(await takeStagedBillLines()).toEqual([soap]);
});

it("does not add an abandoned batch to a later sale", async () => {
  storage.value = { lines: [soap], stagedAt: Date.now() - 31 * 60 * 1000 };
  await stageBillLines([shampoo]);
  expect(await takeStagedBillLines()).toEqual([shampoo]);
});
