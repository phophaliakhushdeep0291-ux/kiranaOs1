/**
 * Adversarial / edge-case probe against a LIVE backend.
 * Run the server with relaxed limiters, then: node loadtest/adversarial.js
 * Exercises real endpoints + real DB + real money/GST math (not source checks).
 */
const BASE = process.env.LOADTEST_BASE_URL || "http://127.0.0.1:3000";

let pass = 0, fail = 0;
const fails = [];
function check(name, cond, detail = "") {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; fails.push(name); console.log(`  FAIL  ${name}  ${detail}`); }
}

async function api(path, { method = "GET", token, device = "adv-device-1", body, headers = {} } = {}) {
  const h = { "content-type": "application/json", ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (device) h["x-device-id"] = device;
  const res = await fetch(`${BASE}${path}`, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body: json };
}
const tok = (b) => b?.data?.accessToken || b?.accessToken || b?.data?.token || null;

async function freshShop(tag) {
  const mobile = `9${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 10);
  const r = await api("/api/auth/register", { method: "POST", device: null, body: {
    shopName: `Adv ${tag}`, ownerName: "Tester", city: "Jaipur", address: "Probe lane 42", mobile, password: "adv-pass-123", ownerPin: "1234",
  }});
  return { token: tok(r.body), mobile, ownerPin: "1234", status: r.status };
}

async function makeBill({ token, gstMode, items, discount = 0, pay }) {
  return api("/api/bills/confirm", { token, method: "POST", body: {
    billType: "normal_sale", gstMode, customerName: "Walk-in", items, discount,
    payments: [{ mode: "cash", amount: pay }], buyerPaidAmount: pay, actualAmount: pay,
  }});
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

async function main() {
  const health = await api("/api/health", { device: null });
  if (health.status !== 200) { console.error(`Server not healthy at ${BASE}`); process.exit(2); }
  console.log(`Target ${BASE} healthy.\n`);

  const A = await freshShop("A");
  const B = await freshShop("B");
  check("register returns a token", Boolean(A.token), `status ${A.status}`);
  if (!A.token) process.exit(2);

  console.log("\n— Auth edge cases —");
  check("wrong password → 401", (await api("/api/auth/login", { method: "POST", device: null, body: { mobile: A.mobile, password: "WRONG" } })).status === 401);
  check("no token on protected route → 401", (await api("/api/products", { token: undefined })).status === 401);
  check("garbage token → 401", (await api("/api/products", { token: "not.a.jwt" })).status === 401);
  const tampered = A.token.slice(0, -3) + (A.token.slice(-3) === "aaa" ? "bbb" : "aaa");
  check("tampered-signature token → 401", (await api("/api/products", { token: tampered })).status === 401);

  console.log("\n— GST correctness (inclusive vs exclusive) —");
  // Inclusive: ₹118 entered at 18% → customer pays 118, GST extracted = 18.
  const inc = await makeBill({ token: A.token, gstMode: "inclusive", items: [{ name: "Ghee 1L", quantity: 1, enteredUnit: "pc", ratePerRateUnit: 118, gstRate: 18 }], pay: 118 });
  const incBill = inc.body?.data ?? inc.body;
  check("inclusive bill accepted", inc.status === 201, `status ${inc.status} ${JSON.stringify(inc.body).slice(0,160)}`);
  check("inclusive grandTotal = 118 (unchanged)", round2(incBill?.grandTotal) === 118, `got ${incBill?.grandTotal}`);
  check("inclusive GST extracted = 18.00", round2(incBill?.gst) === 18, `got ${incBill?.gst}`);
  // Exclusive: ₹100 at 18% → GST added → pay 118.
  const exc = await makeBill({ token: A.token, gstMode: "exclusive", items: [{ name: "Soap", quantity: 1, enteredUnit: "pc", ratePerRateUnit: 100, gstRate: 18 }], pay: 118 });
  const excBill = exc.body?.data ?? exc.body;
  check("exclusive bill accepted", exc.status === 201, `status ${exc.status} ${JSON.stringify(exc.body).slice(0,160)}`);
  check("exclusive grandTotal = 118 (added on top)", round2(excBill?.grandTotal) === 118, `got ${excBill?.grandTotal}`);
  check("exclusive GST added = 18.00", round2(excBill?.gst) === 18, `got ${excBill?.gst}`);
  // GST report aggregates both (≈36 collected).
  const gstRep = await api("/api/reports/gst?range=monthly", { token: A.token });
  check("GST report endpoint 200", gstRep.status === 200, `status ${gstRep.status}`);
  check("GST report collected ≈ 36", Math.abs((gstRep.body?.data?.gstCollected ?? 0) - 36) < 0.1, `got ${gstRep.body?.data?.gstCollected}`);
  check("GST report cgst = sgst (intra-state split)", round2(gstRep.body?.data?.cgst) === round2(gstRep.body?.data?.sgst), JSON.stringify(gstRep.body?.data));

  console.log("\n— GST hard rounding / mixed rates —");
  // 28% inclusive on an odd price: payable must stay exact; cgst+sgst must
  // reconcile to gst with no lost paisa.
  const odd = await makeBill({ token: A.token, gstMode: "inclusive", items: [{ name: "Odd", quantity: 1, enteredUnit: "pc", ratePerRateUnit: 99.99, gstRate: 28 }], pay: 99.99 });
  const oddBill = odd.body?.data ?? odd.body;
  check("odd-price 28% inclusive: grandTotal unchanged 99.99", round2(oddBill?.grandTotal) === 99.99, `got ${oddBill?.grandTotal}`);
  const expectedOddGst = round2(99.99 - 99.99 / 1.28);
  check(`odd-price GST extracted = ${expectedOddGst}`, round2(oddBill?.gst) === expectedOddGst, `got ${oddBill?.gst}`);
  // Mixed rates + bill discount: subtotal 223, discount 23 → payable 200,
  // GST extracted = 18 (on the 18% item) + 5 (on the 5% item) = 23.
  const mixed = await makeBill({ token: A.token, gstMode: "inclusive", discount: 23, items: [
    { name: "A18", quantity: 1, enteredUnit: "pc", ratePerRateUnit: 118, gstRate: 18 },
    { name: "B05", quantity: 1, enteredUnit: "pc", ratePerRateUnit: 105, gstRate: 5 },
  ], pay: 200 });
  const mixedBill = mixed.body?.data ?? mixed.body;
  check("mixed-rate inclusive + discount: grandTotal = 200", round2(mixedBill?.grandTotal) === 200, `got ${mixedBill?.grandTotal}`);
  check("mixed-rate GST extracted = 23.00", round2(mixedBill?.gst) === 23, `got ${mixedBill?.gst}`);

  console.log("\n— Money-safety rejections —");
  const neg = await makeBill({ token: A.token, gstMode: "inclusive", items: [{ name: "X", quantity: -1, enteredUnit: "pc", ratePerRateUnit: 50, gstRate: 0 }], pay: 50 });
  check("negative quantity → rejected (4xx)", neg.status >= 400 && neg.status < 500, `status ${neg.status}`);
  const negP = await makeBill({ token: A.token, gstMode: "inclusive", items: [{ name: "X", quantity: 1, enteredUnit: "pc", ratePerRateUnit: -50, gstRate: 0 }], pay: 50 });
  check("negative price → rejected (4xx)", negP.status >= 400 && negP.status < 500, `status ${negP.status}`);
  const over = await makeBill({ token: A.token, gstMode: "inclusive", items: [{ name: "X", quantity: 1, enteredUnit: "pc", ratePerRateUnit: 100, gstRate: 0 }], discount: 250, pay: 0 });
  check("discount > total → rejected", over.status >= 400 && over.status < 500, `status ${over.status}`);
  const underpay = await makeBill({ token: A.token, gstMode: "inclusive", items: [{ name: "X", quantity: 1, enteredUnit: "pc", ratePerRateUnit: 100, gstRate: 0 }], pay: 40 });
  check("payment less than total (no credit) → rejected", underpay.status >= 400 && underpay.status < 500, `status ${underpay.status}`);
  const overpay = await makeBill({ token: A.token, gstMode: "inclusive", items: [{ name: "X", quantity: 1, enteredUnit: "pc", ratePerRateUnit: 100, gstRate: 0 }], pay: 999 });
  check("payment more than total → rejected", overpay.status >= 400 && overpay.status < 500, `status ${overpay.status}`);
  const nan = await makeBill({ token: A.token, gstMode: "inclusive", items: [{ name: "X", quantity: 1, enteredUnit: "pc", ratePerRateUnit: "abc", gstRate: 0 }], pay: 0 });
  check("non-numeric price → rejected", nan.status >= 400 && nan.status < 500, `status ${nan.status}`);
  const empty = await api("/api/bills/confirm", { token: A.token, method: "POST", body: { billType: "normal_sale", items: [], payments: [] } });
  check("empty item list → rejected", empty.status >= 400 && empty.status < 500, `status ${empty.status}`);

  console.log("\n— Owner-PIN gating on protected fields —");
  // Price is a protected field: create WITHOUT a PIN must be blocked.
  const noPin = await api("/api/products", { token: A.token, method: "POST", body: { name: `NoPin-${Date.now()}`, defaultPricePerRateUnit: 50, gstRate: 5 } });
  check("create product w/ price but no owner PIN → 403", noPin.status === 403, `status ${noPin.status}`);

  console.log("\n— Tenant isolation + concurrency —");
  // Make a product in shop A (with the owner PIN), then try to read it from shop B.
  const prod = await api("/api/products", { token: A.token, method: "POST", body: { name: `Probe-${Date.now()}`, defaultPricePerRateUnit: 50, gstRate: 5, ownerPin: A.ownerPin } });
  const pid = (prod.body?.data ?? prod.body)?.id;
  check("product create with owner PIN → 201", prod.status === 201 && Boolean(pid), `status ${prod.status} ${JSON.stringify(prod.body).slice(0,140)}`);
  if (pid && B.token) {
    const cross = await api(`/api/products/${pid}`, { token: B.token, device: "adv-device-B" });
    check("shop B cannot read shop A product → 404", cross.status === 404, `status ${cross.status}`);
  }
  if (pid) {
    const stale = await api(`/api/products/${pid}`, { token: A.token, method: "PATCH", body: { name: "Renamed", baseUpdatedAt: "2020-01-01T00:00:00.000Z" } });
    check("stale baseUpdatedAt → 409 optimistic-concurrency", stale.status === 409, `status ${stale.status} ${JSON.stringify(stale.body).slice(0,120)}`);
    const fresh = await api(`/api/products/${pid}`, { token: A.token, method: "PATCH", body: { name: "Renamed OK" } });
    check("update without baseUpdatedAt still works (legacy LWW)", fresh.status === 200, `status ${fresh.status}`);
  }

  console.log("\n— Device binding (token bound to its login device) —");
  // The same token used from a different device id must be rejected (session-
  // device binding + plan device limit both enforce single-device on starter).
  const dev2 = await api("/api/products", { token: A.token, device: "adv-device-2" });
  check("2nd device id on a bound token → 403", dev2.status === 403 && /device|session/i.test(JSON.stringify(dev2.body)), `status ${dev2.status} ${JSON.stringify(dev2.body).slice(0,120)}`);

  console.log(`\n${"=".repeat(48)}\nRESULT: ${pass} passed, ${fail} failed`);
  if (fail > 0) { console.log("Failures:", fails.join(" | ")); process.exit(1); }
}

main().catch((e) => { console.error("PROBE CRASH:", e.message); process.exit(2); });
