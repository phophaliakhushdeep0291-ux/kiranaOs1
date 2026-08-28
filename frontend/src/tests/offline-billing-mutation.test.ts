import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { useMutation, createBillLocalFirst, createBill } = vi.hoisted(() => ({
  useMutation: vi.fn((options: unknown) => options),
  createBillLocalFirst: vi.fn(),
  createBill: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useMutation }));
vi.mock("@/features/core/billing/local-actions", () => ({ createBillLocalFirst }));
vi.mock("@/features/core/billing/api", () => ({ createBill }));

import { useConfirmBill } from "@/features/core/billing/queries";

describe("offline billing mutation", () => {
  beforeEach(() => {
    useMutation.mockClear();
    createBillLocalFirst.mockClear();
    createBill.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("keeps rejected QR settlements out of the local success path", async () => {
    vi.stubGlobal("navigator", { onLine: true });
    const options = useConfirmBill() as unknown as { mutationFn: (v: { data: Record<string, unknown> }) => Promise<unknown> };
    const data = { clientBillId: "stable-retry-id", items: [{ guestOrderId: "guest-1", guestOrderLineId: "guest-1-0" }] };
    createBill.mockRejectedValueOnce(new Error("Include every guest order line before settling the table."));
    await expect(options.mutationFn({ data })).rejects.toThrow("Include every guest order line");
    expect(createBillLocalFirst).not.toHaveBeenCalled();
    createBill.mockResolvedValueOnce({ id: "server-bill" });
    await expect(options.mutationFn({ data })).resolves.toEqual({ id: "server-bill" });
    expect(createBill).toHaveBeenLastCalledWith(data);
  });

  it("refuses offline guest settlement", () => {
    vi.stubGlobal("navigator", { onLine: false });
    const options = useConfirmBill() as unknown as { mutationFn: (v: { data: Record<string, unknown> }) => Promise<unknown> };
    expect(() => options.mutationFn({ data: { items: [{ guestOrderId: "guest-1" }] } })).toThrow("Connect to settle a QR order");
    expect(createBillLocalFirst).not.toHaveBeenCalled();
    expect(createBill).not.toHaveBeenCalled();
  });

  it("settles a linked customer order online and never announces a local-only success", async () => {
    const data = { sourceOrderId: "order-1", items: [{ productId: "p1" }] };
    vi.stubGlobal("navigator", { onLine: true });
    const online = useConfirmBill() as unknown as { mutationFn: (v: { data: Record<string, unknown> }) => Promise<unknown> };
    createBill.mockResolvedValueOnce({ id: "server-bill" });
    await expect(online.mutationFn({ data })).resolves.toEqual({ id: "server-bill" });
    expect(createBillLocalFirst).not.toHaveBeenCalled();

    vi.stubGlobal("navigator", { onLine: false });
    const offline = useConfirmBill() as unknown as { mutationFn: (v: { data: Record<string, unknown> }) => Promise<unknown> };
    expect(() => offline.mutationFn({ data })).toThrow("Connect to settle this customer order");
  });

  it("runs while the browser is offline so IndexedDB receives the bill", async () => {
    const options = useConfirmBill() as unknown as {
      networkMode: string;
      mutationFn: (variables: { data: Record<string, unknown> }) => Promise<unknown>;
    };

    expect(options.networkMode).toBe("always");

    const data = { billType: "normal_sale" };
    createBillLocalFirst.mockResolvedValueOnce({ id: "local-bill" });
    await options.mutationFn({ data });

    expect(createBillLocalFirst).toHaveBeenCalledOnce();
    expect(createBillLocalFirst).toHaveBeenCalledWith(data);
  });
});
