import { describe, expect, it } from "vitest";

describe("live registration response", () => {
  it("prints the current envelope keys", async () => {
    const id = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const response = await fetch("http://127.0.0.1:3000/api/auth/register", { method: "POST", headers: { "content-type": "application/json", "x-device-id": `response_inspect_${id}` }, body: JSON.stringify({ shopName: "Response QA", ownerName: "QA", city: "Jaipur", mobile: `7${id.slice(-9)}`, password: "Test@12345", ownerPin: "2468" }) });
    const json = await response.json();
    console.log(JSON.stringify(json, null, 2));
    expect(response.ok).toBe(true);
  });
});
