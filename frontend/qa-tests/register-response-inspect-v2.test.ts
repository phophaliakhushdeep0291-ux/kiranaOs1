import { describe, expect, it } from "vitest";

describe("live registration response v2", () => {
  it("prints the current successful envelope", async () => {
    const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const response = await fetch("http://127.0.0.1:3000/api/auth/register", { method: "POST", headers: { "content-type": "application/json", "x-device-id": `response_inspect_${id}` }, body: JSON.stringify({ shopName: "Response QA", ownerName: "QA Owner", city: "Jaipur", address: "Automated QA", mobile: `7${id.slice(-9)}`, password: "Test@12345", ownerPin: "2468" }) });
    const json = await response.json();
    console.log(JSON.stringify(json, null, 2));
    expect(response.ok).toBe(true);
  });
});
