import { QueryClient, QueryObserver, onlineManager } from "@tanstack/react-query";
import { expect, it } from "vitest";
import { shouldWaitForBillingCatalogue as waitForCatalogue } from "@/features/core/billing/catalogue-readiness";

it("waits for the first catalogue even when placeholder data reports a successful query", async () => {
  const client = new QueryClient();
  let resolve!: (rows: string[]) => void;
  const observer = new QueryObserver(client, { queryKey: ["products"], placeholderData: [] as string[], queryFn: () => new Promise<string[]>(done => { resolve = done; }) });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    const initial = observer.getCurrentResult();
    expect(initial.isLoading).toBe(false); expect(initial.data).toEqual([]);
    expect(waitForCatalogue(initial, 0)).toBe(true);
    const finished = observer.refetch(); resolve(["labels"]); await finished;
    expect(waitForCatalogue(observer.getCurrentResult(), 1)).toBe(false);
  } finally { unsubscribe(); client.clear(); }
});

it("accepts a real empty catalogue and cached products during background refresh", async () => {
  const client = new QueryClient();
  const observer = new QueryObserver(client, { queryKey: ["products"], placeholderData: [] as string[], queryFn: async () => [] as string[] });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    expect(waitForCatalogue(observer.getCurrentResult(), 3)).toBe(false);
    await observer.refetch();
    expect(waitForCatalogue(observer.getCurrentResult(), 0)).toBe(false);
  } finally { unsubscribe(); client.clear(); }
});

it("does not block offline billing on a paused network request", () => {
  onlineManager.setOnline(false);
  const client = new QueryClient();
  const observer = new QueryObserver(client, { queryKey: ["products"], placeholderData: [] as string[], queryFn: async () => [] as string[] });
  const unsubscribe = observer.subscribe(() => undefined);
  try {
    expect(observer.getCurrentResult().fetchStatus).toBe("paused");
    expect(waitForCatalogue(observer.getCurrentResult(), 0)).toBe(false);
  } finally { unsubscribe(); client.clear(); onlineManager.setOnline(true); }
});
