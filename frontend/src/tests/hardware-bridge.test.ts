import { describe, expect, it } from "vitest";
import { normalizeHardwareBridgeUrl } from "@/features/hardware/local-hardware-bridge";

describe("local hardware bridge security boundary", () => {
  it("accepts only loopback HTTP(S) endpoints", () => {
    expect(normalizeHardwareBridgeUrl("http://127.0.0.1:17873/")).toBe("http://127.0.0.1:17873");
    expect(normalizeHardwareBridgeUrl("https://localhost:17873")).toBe("https://localhost:17873");
    expect(() => normalizeHardwareBridgeUrl("https://printer.example.com")).toThrow(/localhost/i);
    expect(() => normalizeHardwareBridgeUrl("http://192.168.1.20:17873")).toThrow(/localhost/i);
  });

  it("rejects embedded credentials and query-string routing", () => {
    expect(() => normalizeHardwareBridgeUrl("http://user:pass@127.0.0.1:17873")).toThrow(/credentials/i);
    expect(() => normalizeHardwareBridgeUrl("http://127.0.0.1:17873?target=remote")).toThrow(/query/i);
  });
});
