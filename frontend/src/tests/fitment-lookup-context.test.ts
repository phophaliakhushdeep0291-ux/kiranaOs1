import { expect, it } from "vitest";
import { createFitmentLookupContext } from "@/features/verticals/auto-parts/fitment/lookup-context";

it("does not replace the current store's result with a late response from the previous store", async () => {
  const counter = createFitmentLookupContext();
  let finish!: (stock: number) => void;
  const oldLookup = counter.run(() => new Promise<number>((resolve) => { finish = resolve; }));
  counter.invalidate();
  expect(await counter.run(async () => 2)).toEqual({ current: true, value: 2 });
  finish(20);
  expect(await oldLookup).toEqual({ current: false });
});

it("also discards failures and responses after leaving and returning to the same store", async () => {
  const counter = createFitmentLookupContext();
  let fail!: (error: Error) => void;
  const oldLookup = counter.run(() => new Promise<never>((_resolve, reject) => { fail = reject; }));
  counter.invalidate(); counter.invalidate();
  fail(new Error("old store unavailable"));
  expect(await oldLookup).toEqual({ current: false });
  await expect(counter.run(async () => { throw new Error("current store unavailable"); })).rejects.toThrow("current store unavailable");
});
