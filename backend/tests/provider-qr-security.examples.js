import assert from "node:assert/strict";
import { fetchProviderQrPng } from "../src/modules/payment-provider/retailPayment.service.js";

const originalFetch = globalThis.fetch;
try {
  let calls = 0;
  globalThis.fetch = async (_url, options) => {
    calls++;
    assert.equal(options.redirect, "error");
    return new Response(new Uint8Array([0x89, 0x50]));
  };
  for (const url of ["http://rzp.io/qr", "https://rzp.io.evil.test/qr", "https://127.0.0.1/qr",
    "https://169.254.169.254/metadata", "https://[::1]/qr", "https://rzp.io:8443/qr",
    "https://user:password@rzp.io/qr", "file:///etc/passwd"]) {
    await assert.rejects(fetchProviderQrPng(url), { code: "RETAIL_QR_PROVIDER_MISMATCH" });
  }
  assert.equal(calls, 0, "untrusted URLs must be refused before the network");
  assert.deepEqual(await fetchProviderQrPng("https://rzp.io/i/test"), Buffer.from([0x89, 0x50]));
  let cancelled = false;
  let pulls = 0;
  globalThis.fetch = async () => new Response(new ReadableStream({
    pull(controller) { pulls++; controller.enqueue(new Uint8Array(1024 * 1024)); },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 }));
  await assert.rejects(fetchProviderQrPng("https://rzp.io/i/large"), /too large/);
  assert.equal(cancelled, true);
  assert.equal(pulls, 3, "chunked response must stop reading at its byte limit");
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.redirect, "error");
    throw new TypeError("unexpected redirect");
  };
  await assert.rejects(fetchProviderQrPng("https://rzp.io/i/redirect"), { code: "RETAIL_QR_IMAGE_UNAVAILABLE" });
} finally { globalThis.fetch = originalFetch; }
console.log("Provider QR security tests passed");
