import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

describe("cold boot experience", () => {
  it("offers recovery after a stalled boot even with whitespace around the placeholder", () => {
    const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");
    const guard = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).find((script) => script.includes("function rootEmpty"))!;
    const root = { childNodes: [{}, {}, {}], children: [{}], innerHTML: "waiting" };
    const wait = { parentNode: root };
    let timeout: (() => void) | undefined;
    runInNewContext(guard, {
      document: { getElementById: (id: string) => id === "root" ? root : id === "artha-boot-wait" ? wait : null },
      window: { addEventListener() {} },
      setTimeout: (callback: () => void) => { timeout = callback; },
    });
    timeout!();
    expect(root.innerHTML).toContain("Artha could not start");
    expect(root.innerHTML).toContain("Reload app");
  });

  it("leaves an already mounted counter untouched by the boot timeout", () => {
    const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");
    const guard = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]).find((script) => script.includes("function rootEmpty"))!;
    const root = { childNodes: [{}], children: [{}], innerHTML: "counter" };
    let timeout: (() => void) | undefined;
    runInNewContext(guard, {
      document: { getElementById: (id: string) => id === "root" ? root : null },
      window: { addEventListener() {} },
      setTimeout: (callback: () => void) => { timeout = callback; },
    });
    timeout!();
    expect(root.innerHTML).toBe("counter");
  });
  it("shows a neutral startup state and avoids a premature fatal timeout", () => {
    const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

    expect(html).toContain('id="artha-boot-wait"');
    expect(html).toContain("Opening your counter");
    expect(html).toContain('location.replace("/login?recover=" + Date.now())');
    expect(html).toContain("wait.parentNode === root");
    expect(html).toContain("}, 20000)");
    expect(html).toContain('window.addEventListener("error"');
    expect(html).toContain('window.addEventListener("unhandledrejection"');
  });
});
