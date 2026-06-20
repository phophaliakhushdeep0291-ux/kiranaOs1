import { beforeEach, describe, expect, it, vi } from "vitest";

const { useMutation, createBillLocalFirst } = vi.hoisted(() => ({
  useMutation: vi.fn((options: unknown) => options),
  createBillLocalFirst: vi.fn(),
}));

vi.mock("@tanstack/react-query", () => ({ useMutation }));
vi.mock("@/features/billing/local-actions", () => ({ createBillLocalFirst }));

import { useConfirmBill } from "@/features/billing/queries";

describe("offline billing mutation", () => {
  beforeEach(() => {
    useMutation.mockClear();
    createBillLocalFirst.mockClear();
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
