// Two real, isolated browser profiles: no shared storage or injected sync state.
// API writes only provision this run's synthetic shop, product and customer.
// Sales and collections use cashier forms; IndexedDB is inspected read-only.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CdpClient, waitForHttp, waitForExit, waitForPage, navigate, enrollQaDevice, setOffline, pageHelpers } from "./live-udhar-sync-smoke.mjs";

const frontendUrl = process.env.FRONTEND_URL ?? "http://localhost:5173";
const apiUrl = process.env.API_URL ?? "http://localhost:3000/api";
const chromePath = process.env.CHROME_PATH ?? (process.platform === "darwin"
  ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  : "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe");
const debugPort = Number(process.env.CHROME_DEBUG_PORT ?? 9441);
const outputDir = path.resolve(process.env.QA_TWO_COUNTER_OUTPUT_DIR ?? "qa-artifacts/offline-two-counter");
const counters = [];
const report = { generatedAt: new Date().toISOString(), passed: false, databaseEngine: process.env.QA_DATABASE_ENGINE ?? "unspecified", scenario: "two independent counters: offline sales and collections, reload, staggered reconnect, repeated sync and contested collection", checks: [] };
const check = (name, evidence) => { report.checks.push({ name, evidence }); console.log(`PASS ${name}`); };

async function startCounter(index) {
  const profile = await mkdtemp(path.join(tmpdir(), `kirana-two-counter-${index}-`));
  const chrome = spawn(chromePath, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${debugPort + index}`, `--user-data-dir=${profile}`, `${frontendUrl}/register`], { stdio: ["ignore", "ignore", "pipe"] });
  const counter = { name: index ? "B" : "A", profile, chrome, chromeErrors: "" };
  counters.push(counter);
  chrome.stderr.on("data", (chunk) => { counter.chromeErrors = (counter.chromeErrors + String(chunk)).slice(-4000); });
  chrome.on("error", (error) => { counter.chromeErrors += error.message; });
  try {
    await waitForHttp(`http://127.0.0.1:${debugPort + index}/json/version`);
  } catch (error) {
    throw new Error(`Counter ${counter.name} browser failed to start (exit=${chrome.exitCode}, signal=${chrome.signalCode}): ${counter.chromeErrors}`, { cause: error });
  }
  let target;
  const deadline = Date.now() + 15_000;
  while (!target && Date.now() < deadline) {
    const targets = await (await waitForHttp(`http://127.0.0.1:${debugPort + index}/json`)).json();
    target = targets.find((entry) => entry.type === "page" && entry.url.startsWith(frontendUrl));
    if (!target) await new Promise((resolve) => setTimeout(resolve, 150));
  }
  assert.ok(target?.webSocketDebuggerUrl, "QA Chrome target missing");
  counter.client = new CdpClient(target.webSocketDebuggerUrl);
  await counter.client.connect();
  for (const domain of ["Page", "Runtime", "Network"]) await counter.client.send(`${domain}.enable`);
  await counter.client.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await go(counter, "/register");
  return counter;
}

async function go(counter, route) {
  await navigate(counter.client, `${frontendUrl}${route}`);
  await counter.client.evaluateFunction(pageHelpers.install, null);
}
const wait = (counter, predicate, argument, timeout = 30_000) => waitForPage(counter.client, predicate, argument, timeout);
const click = (counter, selector) => counter.client.evaluateFunction(pageHelpers.click, selector);
const fill = (counter, selector, value) => counter.client.evaluateFunction(pageHelpers.fill, { selector, value: String(value) });
const read = (counter, store) => counter.client.evaluateFunction((store) => window.__qaReadStore(store), store);

async function authenticate(counter, mobile, runId, register) {
  const result = await counter.client.evaluateFunction(async ({ apiUrl, mobile, runId, register, name }) => {
    localStorage.setItem("kiranaApiBaseUrl", apiUrl);
    const deviceId = localStorage.getItem("kiranaos_device_id") ?? localStorage.getItem("kirana-os:device-id:v1");
    if (!deviceId) throw new Error("Application did not initialize its device identity");
    const response = await fetch(`${apiUrl}/auth/${register ? "register" : "login"}`, {
      method: "POST", headers: { "content-type": "application/json", "x-device-id": deviceId },
      body: JSON.stringify({ mobile, password: "Test@12345", ...(register ? { shopName: `Two Counter QA ${runId}`, ownerName: "KiranaOS QA", city: "Jodhpur", address: "Disposable two-counter test shop", ownerPin: "2468" } : {}), device: { deviceId, deviceName: `QA counter ${name}`, deviceType: "desktop", platform: "web" } }),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(json));
    const auth = json.data ?? json;
    localStorage.setItem("kiranaos.auth.session.v1", JSON.stringify({ accessToken: auth.accessToken ?? auth.token, refreshToken: auth.refreshToken, user: auth.user, shop: auth.shop }));
    localStorage.setItem("kirana-os:ui-language:v1", "en");
    return { shopId: auth.shop.id, deviceId };
  }, { apiUrl, mobile, runId, register, name: counter.name });
  Object.assign(counter, result);
  return result;
}

async function request(counter, route, body) {
  return counter.client.evaluateFunction(async ({ apiUrl, route, body }) => {
    const session = JSON.parse(localStorage.getItem("kiranaos.auth.session.v1"));
    const response = await fetch(`${apiUrl}${route}`, { method: body ? "POST" : "GET", headers: {
      "content-type": "application/json", authorization: `Bearer ${session.accessToken}`, "x-device-id": localStorage.getItem("kiranaos_device_id"), "x-owner-pin": "2468",
    }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const json = await response.json();
    if (!response.ok) throw new Error(`${route}: ${JSON.stringify(json)}`);
    return json.data ?? json;
  }, { apiUrl, route, body });
}

async function assertLocal(counter, product, customer, stock, balance) {
  await wait(counter, async ({ productId, customerId, stock, balance }) => {
    const products = await window.__qaReadStore("products");
    const customers = await window.__qaReadStore("customers");
    const product = products.find((row) => row.id === productId || row.server_id === productId);
    const customer = customers.find((row) => row.id === customerId || row.server_id === customerId);
    return Number(product?.stockBaseQty ?? product?.stock_base_qty) === stock && Number(customer?.udharAmount ?? customer?.udhar_amount) === balance;
  }, { productId: product.id, customerId: customer.id, stock, balance }, 60_000);
}

async function collect(counter, customer, amount, expectedBalance) {
  await go(counter, "/udhar");
  await wait(counter, (name) => [...document.querySelectorAll("[data-customer-name]")].some((row) => row.getAttribute("data-customer-name") === name), customer.name);
  await counter.client.evaluateFunction((name) => [...document.querySelectorAll("[data-customer-name]")].find((row) => row.getAttribute("data-customer-name") === name).click(), customer.name);
  await wait(counter, () => Boolean(document.querySelector("#customer-payment-amount")));
  await fill(counter, "#customer-payment-amount", amount);
  await wait(counter, () => Boolean(document.querySelector('[data-customer-collect-payment="true"]:not([disabled])')));
  await click(counter, '[data-customer-collect-payment="true"]');
  await wait(counter, (amount) => Number(document.querySelector("[data-customer-outstanding]")?.getAttribute("data-customer-outstanding")) === amount, expectedBalance);
}

async function sync(counter) {
  await go(counter, "/sync-status");
  await wait(counter, () => Boolean(document.querySelector('[data-testid="button-force-sync"]')));
  await click(counter, '[data-testid="button-force-sync"]');
  await wait(counter, async () => (await window.__qaReadStore("sync_outbox")).every((row) => row.status === "SYNCED"), null, 60_000);
}

async function screenshot(counter, name) {
  const shot = await counter.client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path.join(outputDir, name), Buffer.from(shot.data, "base64"));
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const mobile = `9${runId.slice(-9)}`;
  const a = await startCounter(0);
  await authenticate(a, mobile, runId, true);
  const product = await request(a, "/products", { name: `Counter Sugar ${runId.slice(-6)}`, category: "Test", aliases: [], displayUnit: "piece", baseUnit: "piece", rateUnit: "piece", stockBaseQty: 20, costPerRateUnit: 120, minPricePerRateUnit: 150, defaultPricePerRateUnit: 200, gstRate: 0, mrp: 200, reorderLevel: 2, lowStockThreshold: 2, isLooseItem: false });
  const customer = await request(a, "/customers", { name: `Counter Customer ${runId.slice(-6)}`, mobile: `8${runId.slice(-9)}`, type: "udhar", udharAmount: 1000 });
  const b = await startCounter(1);
  await authenticate(b, mobile, runId, false);
  assert.equal(a.shopId, b.shopId);
  assert.notEqual(a.deviceId, b.deviceId);
  check("independent registered devices in the same synthetic shop", { shopId: a.shopId, devices: [a.deviceId, b.deviceId] });
  for (const counter of counters) {
    await enrollQaDevice(counter.client);
    for (const route of ["/inventory", "/udhar", "/sync-status", "/billing"]) await go(counter, route);
    await assertLocal(counter, product, customer, 20, 1000);
  }
  check("both counters start from stock 20 and udhar 1000", {});
  for (const counter of counters) {
    await setOffline(counter.client, true);
    assert.equal(await counter.client.evaluate("navigator.onLine"), false);
    assert.equal(await counter.client.evaluateFunction(async (url) => { try { await fetch(`${url}/health?offlineProbe=${Date.now()}`, { cache: "no-store" }); return false; } catch { return true; } }, apiUrl), true);
  }
  check("both counters have blocked network requests", {});
  for (const [index, counter] of counters.entries()) {
    await go(counter, "/billing");
    const selector = `[data-testid="product-card-${product.id}"]`;
    await wait(counter, (selector) => Boolean(document.querySelector(selector)), selector);
    await click(counter, selector);
    await click(counter, '[data-testid="button-change-customer"]');
    await click(counter, '[data-testid="button-payment-cash"]');
    await wait(counter, () => Boolean(document.querySelector('[data-testid="button-confirm-bill"]:not([disabled])')));
    await click(counter, '[data-testid="button-confirm-bill"]');
    await wait(counter, async () => (await window.__qaReadStore("sync_outbox")).some((row) => row.operation_type === "CREATE_BILL" && row.status === "PENDING"));
    const amount = index ? 125 : 75;
    await collect(counter, customer, amount, 1000 - amount);
    await assertLocal(counter, product, customer, 19, 1000 - amount);
    await go(counter, "/inventory"); // Document reload while offline, real WebAuthn unlock.
    await assertLocal(counter, product, customer, 19, 1000 - amount);
    const queued = (await read(counter, "sync_outbox")).filter((row) => row.status === "PENDING");
    assert.deepEqual(queued.filter((row) => row.operation_type !== "AUDIT_LOG_APPEND").map((row) => row.operation_type).sort(), ["CREATE_BILL", "RECORD_PAYMENT"]);
    check(`counter ${counter.name} sale and payment survive offline reload`, { stock: 19, balance: 1000 - amount, operations: queued.map((row) => row.operation_type) });
  }
  await setOffline(b.client, false);
  await sync(b);
  assert.equal(Number((await request(b, `/products/${product.id}`)).stockBaseQty), 19);
  assert.equal(Number((await request(b, "/customers")).find((row) => row.id === customer.id).udharAmount), 875);
  await assertLocal(a, product, customer, 19, 925);
  check("counter B syncs while A retains its independent pending work", {});
  await setOffline(a.client, false);
  await sync(a);
  await sync(b);
  for (const counter of counters) {
    await go(counter, "/inventory");
    await assertLocal(counter, product, customer, 18, 800);
    await screenshot(counter, `counter-${counter.name}-reconciled.png`);
  }
  check("both counters converge to stock 18 and udhar 800", {});
  // Repeating manual sync must not duplicate either sale or collection.
  for (const counter of counters) await sync(counter);
  const serverProduct = await request(a, `/products/${product.id}`);
  const serverCustomer = (await request(a, "/customers")).find((row) => row.id === customer.id);
  const billData = await request(a, "/bills?limit=100");
  const bills = (Array.isArray(billData) ? billData : billData.bills ?? billData.items).filter((row) => row.billType === "normal_sale");
  const ledgerData = await request(a, "/udhar?limit=500");
  const payments = (ledgerData.entries ?? ledgerData.ledger ?? []).filter((row) => row.customerId === customer.id && row.type === "payment");
  assert.equal(Number(serverProduct.stockBaseQty), 18);
  assert.equal(Number(serverCustomer.udharAmount), 800);
  assert.equal(bills.length, 2);
  assert.equal(bills.reduce((total, row) => total + Number(row.grandTotal), 0), 400);
  assert.deepEqual(payments.map((row) => Number(row.amount)).sort((a, b) => a - b), [75, 125]);
  check("repeated sync preserves exactly two sales and two payments", { serverStock: 18, serverBalance: 800, sales: 2, salesTotal: 400, payments: [75, 125] });
  for (const counter of counters) {
    await setOffline(counter.client, true);
    await go(counter, "/inventory");
    await assertLocal(counter, product, customer, 18, 800);
  }
  check("reconciled values survive a second outage and document reload on both counters", {});
  for (const counter of counters) await setOffline(counter.client, false);
  const contestedCustomer = await request(a, "/customers", { name: `Contested Customer ${runId.slice(-6)}`, type: "udhar", udharAmount: 100 });
  for (const counter of counters) {
    await go(counter, "/udhar");
    await assertLocal(counter, product, contestedCustomer, 18, 100);
  }
  for (const counter of counters) await setOffline(counter.client, true);
  for (const counter of counters) {
    await collect(counter, contestedCustomer, 80, 20);
    await assertLocal(counter, product, contestedCustomer, 18, 20);
  }
  await setOffline(a.client, false);
  await sync(a);
  await setOffline(b.client, false);
  await go(b, "/sync-status");
  await wait(b, () => Boolean(document.querySelector('[data-testid="button-force-sync"]')));
  await click(b, '[data-testid="button-force-sync"]');
  await wait(b, async () => (await window.__qaReadStore("sync_outbox")).some((row) => row.operation_type === "RECORD_PAYMENT" && row.status === "CONFLICT"), null, 60_000);
  await wait(b, () => document.body.innerText.includes("Correction required") && document.body.innerText.includes("Backup review"));
  await wait(b, () => document.body.innerText.includes("This payment exceeds the amount still due."));
  await screenshot(b, "counter-B-contested-payment.png");
  const contestedServer = (await request(a, "/customers")).find((row) => row.id === contestedCustomer.id);
  const contestedLedger = await request(a, "/udhar?limit=500");
  const acceptedPayments = (contestedLedger.entries ?? contestedLedger.ledger ?? []).filter((row) => row.customerId === contestedCustomer.id && row.type === "payment");
  assert.equal(Number(contestedServer.udharAmount), 20);
  assert.equal(acceptedPayments.length, 1);
  assert.equal(Number(acceptedPayments[0].amount), 80);
  const conflict = (await read(b, "sync_outbox")).find((row) => row.operation_type === "RECORD_PAYMENT" && row.status === "CONFLICT");
  assert.ok(conflict.last_error?.includes("exceeds") || conflict.error_message?.includes("exceeds"), "Contested payment must carry an actionable rejection reason");
  await go(b, "/sync-status");
  await wait(b, () => document.body.innerText.includes("Correction required"));
  assert.ok((await read(b, "sync_outbox")).some((row) => row.id === conflict.id && row.status === "CONFLICT"));
  check("competing offline collections cannot over-credit customer; rejected payment persists for owner review", { startingBalance: 100, attemptedPayments: [80, 80], acceptedPayments: 1, serverBalance: 20, rejectedStatus: "CONFLICT", visibleCorrectionRequired: true, retainedAfterReload: true });
  report.passed = true;
  report.limitations = ["Two disposable Chrome profiles on one computer, not physical till hardware.", "Database engine is that of the configured QA API; this does not replace PostgreSQL concurrent-transaction certification.", "Provider and hardware integrations are outside this test."];
}

try {
  await main();
} catch (error) {
  report.error = error?.stack ?? String(error);
  for (const counter of counters) {
    if (!counter.client) continue;
    await screenshot(counter, `counter-${counter.name}-failure.png`).catch(() => {});
    counter.failureState = await counter.client.evaluateFunction(async () => ({ path: location.pathname, text: document.body.innerText.slice(0, 5000), products: await window.__qaReadStore("products"), customers: await window.__qaReadStore("customers"), outbox: (await window.__qaReadStore("sync_outbox")).map((row) => ({ id: row.id, entity_id: row.entity_id, operation_type: row.operation_type, status: row.status, last_error: row.last_error, retry_count: row.retry_count })) }), null).catch(() => null);
  }
  report.failureStates = counters.map(({ name, failureState }) => ({ name, failureState }));
  console.error(report.error);
  process.exitCode = 1;
} finally {
  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const counter of counters) {
    counter.client?.close();
    if (counter.chrome.exitCode === null) counter.chrome.kill();
    await waitForExit(counter.chrome);
    counter.chrome.stderr.destroy();
    await rm(counter.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  }
}
