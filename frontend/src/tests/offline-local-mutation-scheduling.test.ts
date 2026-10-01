import { afterEach, describe, expect, it, vi } from "vitest";
import { MutationObserver, QueryClient, onlineManager, type MutationObserverOptions } from "@tanstack/react-query";

vi.mock("@tanstack/react-query", async (original) => ({
  ...await original<typeof import("@tanstack/react-query")>(),
  useMutation: (options: unknown) => options,
}));
vi.mock("@/features/core/products/local-actions", () => ({
  createProductLocalFirst: vi.fn(async () => ({ id: "saved" })),
  updateProductLocalFirst: vi.fn(async () => ({ id: "saved" })),
  deleteProductLocalFirst: vi.fn(async () => ({ id: "saved" })),
}));
vi.mock("@/features/core/customers/local-actions", () => ({
  createCustomerLocalFirst: vi.fn(async () => ({ id: "saved" })),
  updateCustomerLocalFirst: vi.fn(async () => ({ id: "saved" })),
  deleteCustomerLocalFirst: vi.fn(async () => ({ id: "saved" })),
}));
vi.mock("@/features/core/suppliers/local-actions", () => ({
  createSupplierLocalFirst: vi.fn(async () => ({ id: "saved" })),
  updateSupplierLocalFirst: vi.fn(async () => ({ id: "saved" })),
  deleteSupplierLocalFirst: vi.fn(async () => ({ id: "saved" })),
}));
vi.mock("@/features/core/payments/local-actions", () => ({
  recordPaymentLocalFirst: vi.fn(async () => ({ id: "saved" })),
}));
vi.mock("@/features/core/inventory/local-actions", () => ({
  recordPurchaseLocalFirst: vi.fn(async () => ({ id: "saved" })),
  recordDamageLocalFirst: vi.fn(async () => ({ id: "saved" })),
  recordSaleLocalFirst: vi.fn(async () => ({ id: "saved" })),
  stockCorrectionLocalFirst: vi.fn(async () => ({ id: "saved" })),
}));
vi.mock("@/features/core/staff/local-actions", () => ({
  createStaffLocalFirst: vi.fn(async () => ({ id: "saved" })),
  deactivateStaffLocalFirst: vi.fn(async () => ({ id: "saved" })),
}));

import * as products from "@/features/core/products/queries";
import * as customers from "@/features/core/customers/queries";
import * as suppliers from "@/features/core/suppliers/queries";
import * as inventory from "@/features/core/inventory/queries";
import * as settings from "@/features/core/settings/queries";

const hooks = [
  products.useCreateProduct, products.useUpdateProduct, products.useDeleteProduct,
  customers.useCreateCustomer, customers.useUpdateCustomer, customers.useDeleteCustomer,
  customers.useRecordUdharPayment,
  suppliers.useCreateSupplier, suppliers.useUpdateSupplier, suppliers.useDeleteSupplier,
  inventory.useRecordPurchase, inventory.useRecordDamage, inventory.useRecordSale, inventory.useStockCorrection,
  settings.useInviteStaff, settings.useRemoveStaff,
];
type Variables = { id: string; data: Record<string, unknown>; ownerPin: string };
afterEach(() => { onlineManager.setOnline(true); vi.clearAllMocks(); });

describe("local-first mutations during a real QueryClient offline pause", () => {
  it.each(hooks.map((hook) => [hook.name, hook] as const))("%s commits before reconnecting", async (_name, hook) => {
    onlineManager.setOnline(false);
    const client = new QueryClient();
    client.mount();
    const options = hook() as unknown as MutationObserverOptions<unknown, Error, Variables>;
    const observer = new MutationObserver(client, options);
    const result = observer.mutate({ id: "local-id", data: { amount: 75 }, ownerPin: "2468" });
    try {
      await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("success"), { timeout: 150 });
      expect(onlineManager.isOnline()).toBe(false);
      expect(await result).toEqual({ id: "saved" });
    } finally {
      onlineManager.setOnline(true);
      await client.resumePausedMutations();
      await result;
      client.unmount();
      client.clear();
    }
  });
});
