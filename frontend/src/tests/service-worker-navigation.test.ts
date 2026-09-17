// @vitest-environment node
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";

const origin = "https://counter.example";
const installedShell = '<html><script src="/assets/counter-old.js"></script></html>';
const nextShell = '<html><script src="/assets/counter-new.js"></script></html>';
const source = readFileSync("public/sw.js", "utf8")
  .replaceAll("__KIRANA_BUILD_ID__", "installed-build")
  .replace("__KIRANA_CORE_ASSETS__", JSON.stringify(["/assets/counter-old.js"]))
  .replace("__KIRANA_VERTICAL_ASSETS__", "{}");

function response(body: string, status = 200): Response {
  const result = new Response(body, { status });
  Object.defineProperty(result, "type", { value: "basic" });
  return result;
}

function worker() {
  const listeners = new Map<string, (event: any) => void>();
  const entries = new Map<string, Response>();
  const key = (request: string | { url: string }) => new URL(typeof request === "string" ? request : request.url, origin).href;
  const network = vi.fn(async (_request: unknown) => response(installedShell));
  const cache = {
    match: async (request: string | { url: string; headers?: { origin?: string } }, options?: { ignoreVary?: boolean }) => {
      const value = entries.get(key(request));
      // Install requests have no Origin; module imports can carry one. Model
      // Cache API's Vary matching, including the immutable-file opt-out.
      if (value?.headers.get("Vary") === "Origin" && typeof request !== "string" && request.headers?.origin && !options?.ignoreVary) return undefined;
      return value?.clone();
    },
    put: async (request: string | { url: string }, value: Response) => { entries.set(key(request), value.clone()); },
    addAll: async (paths: string[]) => {
      const values = await Promise.all(paths.map((path) => network(path)));
      if (values.some((value) => !value.ok)) throw new Error("install failed");
      await Promise.all(paths.map((path, index) => cache.put(path, values[index])));
    },
  };
  runInNewContext(source, {
    self: { location: { origin }, addEventListener: (name: string, listener: (event: any) => void) => listeners.set(name, listener) },
    caches: { open: async () => cache },
    fetch: network, URL, Response, setTimeout, clearTimeout,
  });
  return {
    network, cache,
    async install() {
      let completion: Promise<unknown> | undefined;
      listeners.get("install")!({ waitUntil: (promise: Promise<unknown>) => { completion = promise; } });
      await completion;
    },
    navigate(path = "/billing", overrides = {}) {
      let result: Promise<Response> | undefined;
      listeners.get("fetch")!({
        request: { url: new URL(path, origin).href, method: "GET", mode: "navigate", destination: "document", ...overrides },
        respondWith: (promise: Promise<Response>) => { result = promise; },
      });
      return result;
    },
  };
}

afterEach(() => vi.useRealTimers());

describe("installed service worker navigation", () => {
  it("keeps a complete installed shell after a newer deployment is visited online", async () => {
    const app = worker();
    await app.install();
    app.network.mockResolvedValue(response(nextShell));
    expect(await (await app.navigate())!.text()).toBe(nextShell);
    app.network.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await (await app.navigate("/inventory"))!.text()).toBe(installedShell);
    expect(await app.cache.match("/assets/counter-old.js")).toBeDefined();
    expect(await app.cache.match("/assets/counter-new.js")).toBeUndefined();
  });

  it.each([500, 502, 503, 504, 408, 429])("reopens the installed counter when the host returns %i", async (status) => {
    const app = worker();
    await app.install();
    app.network.mockResolvedValue(response("Hosting unavailable", status));
    const result = await app.navigate();
    expect(result?.status).toBe(200);
    expect(await result?.text()).toBe(installedShell);
  });

  it("retains the host's error response when no installed shell is available", async () => {
    const app = worker();
    app.network.mockResolvedValue(response("Hosting unavailable", 503));
    expect((await app.navigate())?.status).toBe(503);
  });

  it("bounds a hanging network and never lets a late response replace the installed shell", async () => {
    vi.useFakeTimers();
    const app = worker();
    await app.install();
    let finish!: (value: Response) => void;
    app.network.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const navigation = app.navigate();
    await vi.advanceTimersByTimeAsync(3500);
    expect(await (await navigation)!.text()).toBe(installedShell);
    finish(response(nextShell));
    await vi.advanceTimersByTimeAsync(0);
    expect(await (await app.cache.match("/index.html"))!.text()).toBe(installedShell);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["/order/shop", "/t/shop/table", "/api/products", "/auth/me", "/login", "https://other.example/billing"])("never intercepts public or sensitive navigation: %s", (path) => {
    expect(worker().navigate(path)).toBeUndefined();
  });

  it("keeps the owner's tables screen available offline", async () => {
    const app = worker();
    await app.install();
    app.network.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await (await app.navigate("/tables"))!.text()).toBe(installedShell);
    expect(app.navigate("/billing", { method: "POST" })).toBeUndefined();
  });

  it("serves an installed module offline when the host varies responses by Origin", async () => {
    const app = worker();
    const module = response("export default 'installed'");
    module.headers.set("Vary", "Origin");
    await app.cache.put("/assets/counter-old.js", module);
    app.network.mockRejectedValue(new TypeError("Failed to fetch"));
    const loaded = await app.navigate("/assets/counter-old.js", { mode: "cors", destination: "script", headers: { origin } });
    expect(await loaded?.text()).toBe("export default 'installed'");
    expect(app.network).not.toHaveBeenCalled();
  });

  it("retains Vary protection for images outside the immutable build manifest", async () => {
    const app = worker();
    const image = response("old variant");
    image.headers.set("Vary", "Origin");
    await app.cache.put("/shop-image.png", image);
    app.network.mockResolvedValue(response("correct variant"));
    const loaded = await app.navigate("/shop-image.png", { mode: "cors", destination: "image", headers: { origin } });
    expect(await loaded?.text()).toBe("correct variant");
    expect(app.network).toHaveBeenCalledOnce();
  });
});
