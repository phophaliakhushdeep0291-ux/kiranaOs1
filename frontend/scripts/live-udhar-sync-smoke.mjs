import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.FRONTEND_URL ?? "http://localhost:5173";
const API_URL = process.env.API_URL ?? "http://localhost:3000/api";
const CHROME_PATH = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.CHROME_DEBUG_PORT ?? 9333);
const TEST_AMOUNT = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Browser is still starting.
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CdpClient {
  constructor(webSocketUrl) {
    this.webSocketUrl = webSocketUrl;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.webSocketUrl);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message));
      else waiter.resolve(message.result);
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text);
    }
    return response.result?.value;
  }

  evaluateFunction(fn, argument) {
    return this.evaluate(`(${fn.toString()})(${JSON.stringify(argument)})`);
  }

  close() {
    this.socket?.close();
  }
}

async function waitForPage(client, predicate, argument, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await client.evaluateFunction(predicate, argument)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for page condition: ${String(argument)}`);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitForPage(client, () => document.readyState === "complete", null);
}

async function setOffline(client, offline) {
  await client.send("Network.emulateNetworkConditions", {
    offline,
    latency: offline ? 0 : 20,
    downloadThroughput: offline ? 0 : 5_000_000,
    uploadThroughput: offline ? 0 : 2_000_000,
    connectionType: offline ? "none" : "wifi",
  });
  await sleep(500);
}

const pageHelpers = {
  install: () => {
    window.__qaReadStore = (storeName) => new Promise((resolve, reject) => {
      const request = indexedDB.open("kirana_os_offline");
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction(storeName, "readonly");
        const rows = transaction.objectStore(storeName).getAll();
        let result = [];
        rows.onerror = () => {
          database.close();
          reject(rows.error);
        };
        rows.onsuccess = () => {
          result = rows.result;
        };
        transaction.oncomplete = () => {
          database.close();
          resolve(result);
        };
        transaction.onerror = () => {
          database.close();
          reject(transaction.error);
        };
      };
    });
    return true;
  },
  click: (selector) => {
    const element = document.querySelector(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    element.click();
    return true;
  },
  clickText: ({ selector, text }) => {
    const element = [...document.querySelectorAll(selector)].find((row) => row.textContent?.trim().includes(text));
    if (!element) throw new Error(`Missing ${selector} containing ${text}`);
    element.click();
    return true;
  },
  fill: ({ selector, value }) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLInputElement)) throw new Error(`Missing input: ${selector}`);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return element.value;
  },
};

async function localSnapshot(client, localBillId = null) {
  return client.evaluateFunction(async ({ localBillId: requestedBillId, expectedAmount }) => {
    const read = window.__qaReadStore;
    const [outbox, bills, ledger, customers, mappings] = await Promise.all([
      read("sync_outbox"),
      read("bills"),
      read("customer_ledger"),
      read("customers"),
      read("id_mappings"),
    ]);
    const billEvent = requestedBillId
      ? outbox.find((row) => row.operation_type === "CREATE_BILL" && row.entity_id === requestedBillId)
      : [...outbox].reverse().find((row) => row.operation_type === "CREATE_BILL" && Number(row.payload?.creditAmount ?? 0) === expectedAmount);
    const billId = billEvent?.entity_id ?? requestedBillId;
    const billMapping = mappings.find((row) => row.local_id === billId && row.entity_type === "bill");
    const billIds = new Set([billId, billMapping?.server_id].filter(Boolean));
    const relevantLedger = ledger.filter((row) => {
      if (row.deleted_at != null || row.deletedAt != null) return false;
      const source = row.source_id ?? row.sourceId ?? row.bill_id ?? row.billId;
      return billIds.has(source) && Math.abs(Number(row.amount ?? 0) - expectedAmount) < 0.005;
    });
    return {
      billId,
      billEventId: billEvent?.clientEventId ?? billEvent?.op_id ?? null,
      billServerId: billMapping?.server_id ?? null,
      billEventStatus: billEvent?.status ?? null,
      billEventSyncStatus: billEvent?.sync_status ?? null,
      activeBillCount: bills.filter((row) => billIds.has(row.id) && row.deleted_at == null && row.deletedAt == null).length,
      activeLedgerCount: relevantLedger.length,
      activeLedgerTotal: relevantLedger.reduce((sum, row) => sum + Math.abs(Number(row.amount ?? 0)), 0),
      activeLedgerRows: relevantLedger.map((row) => ({
        id: row.id,
        local_id: row.local_id ?? null,
        server_id: row.server_id ?? null,
        customer_id: row.customer_id ?? row.customerId ?? null,
        bill_id: row.bill_id ?? row.billId ?? row.source_id ?? row.sourceId ?? null,
        amount: Number(row.amount ?? 0),
        sync_status: row.sync_status ?? null,
      })),
      pendingOperations: outbox.filter((row) => row.status === "PENDING" || row.status === "FAILED").map((row) => row.operation_type),
      customerCount: customers.filter((row) => row.deleted_at == null && row.deletedAt == null).length,
    };
  }, { localBillId, expectedAmount: TEST_AMOUNT });
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), "kirana-udhar-sync-"));
  const chrome = spawn(CHROME_PATH, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${profile}`,
    `${FRONTEND_URL}/register`,
  ], { windowsHide: true, stdio: "ignore" });

  let client;
  try {
    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    let target;
    const targetDeadline = Date.now() + 15_000;
    while (Date.now() < targetDeadline && !target) {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      target = targets.find((entry) => entry.type === "page" && entry.url.startsWith(FRONTEND_URL));
      if (!target) await sleep(150);
    }
    if (!target?.webSocketDebuggerUrl) throw new Error("Chrome page target not found");
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Network.enable");
    await navigate(client, `${FRONTEND_URL}/register`);
    await waitForPage(client, () => document.readyState === "complete", null);

    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const mobile = `9${runId.slice(-9)}`;
    const customerMobile = `8${runId.slice(-9)}`;
    const customerName = `Offline Sync ${runId.slice(-6)}`;
    const setup = await client.evaluateFunction(async ({ apiUrl, mobile, runId, amount }) => {
      localStorage.setItem("kiranaApiBaseUrl", apiUrl);
      localStorage.setItem("kirana-os:device-id:v1", `device_live_smoke_${runId}`);
      const registrationResponse = await fetch(`${apiUrl}/auth/register`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-device-id": `device_live_smoke_${runId}` },
        body: JSON.stringify({
          shopName: `Udhar Sync QA ${runId}`,
          ownerName: "KiranaOS QA",
          city: "Jodhpur",
          address: "Automated local browser test shop",
          mobile,
          password: "Test@12345",
          ownerPin: "2468",
        }),
      });
      const registrationJson = await registrationResponse.json();
      if (!registrationResponse.ok) throw new Error(JSON.stringify(registrationJson));
      const auth = registrationJson.data ?? registrationJson;
      localStorage.setItem("kiranaos.auth.session.v1", JSON.stringify({
        accessToken: auth.accessToken ?? auth.token,
        refreshToken: auth.refreshToken,
        user: auth.user,
        shop: auth.shop,
      }));
      const headers = {
        "content-type": "application/json",
        authorization: `Bearer ${auth.accessToken ?? auth.token}`,
        "x-device-id": `device_live_smoke_${runId}`,
        "x-owner-pin": "2468",
      };
      const productResponse = await fetch(`${apiUrl}/products`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: `Sync Test Sugar ${runId.slice(-6)}`,
          category: "Test",
          aliases: [],
          displayUnit: "piece",
          baseUnit: "piece",
          rateUnit: "piece",
          stockBaseQty: 20,
          costPerRateUnit: 120,
          minPricePerRateUnit: 150,
          defaultPricePerRateUnit: amount,
          gstRate: 0,
          mrp: amount,
          reorderLevel: 2,
          lowStockThreshold: 2,
          isLooseItem: false,
        }),
      });
      const productJson = await productResponse.json();
      if (!productResponse.ok) throw new Error(JSON.stringify(productJson));
      return {
        shopId: auth.shop?.id,
        product: productJson.data ?? productJson,
      };
    }, { apiUrl: API_URL, mobile, runId, amount: TEST_AMOUNT });

    await navigate(client, `${FRONTEND_URL}/billing`);
    await client.evaluateFunction(pageHelpers.install, null);
    const productSelector = `[data-testid="product-card-${setup.product.id}"]`;
    await waitForPage(client, (selector) => Boolean(document.querySelector(selector)), productSelector, 30_000);
    await client.evaluateFunction(async () => window.__qaReadStore("bills"), null);
    await client.evaluateFunction(pageHelpers.click, productSelector);
    await waitForPage(client, () => Boolean(document.querySelector('[data-testid="button-confirm-bill"]:not([disabled])')), null);

    await setOffline(client, true);
    await client.evaluateFunction(pageHelpers.clickText, { selector: "button", text: "Change" });
    await client.evaluateFunction(pageHelpers.click, '[data-testid="button-payment-credit"]');
    await waitForPage(client, (selector) => Boolean(document.querySelector(selector)), '[data-testid="input-customer-name"]');
    await client.evaluateFunction(pageHelpers.fill, { selector: '[data-testid="input-customer-name"]', value: customerName });
    await client.evaluateFunction(pageHelpers.fill, { selector: '[data-testid="input-customer-mobile"]', value: customerMobile });
    await waitForPage(client, () => Boolean(document.querySelector('[data-testid="button-confirm-bill"]:not([disabled])')), null);
    await client.evaluateFunction(() => {
      window.__qaDatabaseEvents = [];
      const originalTransaction = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (...args) {
        window.__qaDatabaseEvents.push({ kind: "transaction", stores: Array.isArray(args[0]) ? args[0] : [args[0]], mode: args[1], at: Date.now() });
        const transaction = originalTransaction.apply(this, args);
        transaction.addEventListener("complete", () => window.__qaDatabaseEvents.push({ kind: "transaction-complete", at: Date.now() }));
        transaction.addEventListener("abort", () => window.__qaDatabaseEvents.push({ kind: "transaction-abort", error: transaction.error?.message, at: Date.now() }));
        transaction.addEventListener("error", () => window.__qaDatabaseEvents.push({ kind: "transaction-error", error: transaction.error?.message, at: Date.now() }));
        return transaction;
      };
      window.addEventListener("unhandledrejection", (event) => window.__qaDatabaseEvents.push({ kind: "unhandled-rejection", error: String(event.reason), at: Date.now() }));
      return true;
    }, null);
    await client.evaluateFunction(pageHelpers.click, '[data-testid="button-confirm-bill"]');

    await sleep(1_500);
    const billWriteDiagnostic = await client.evaluateFunction(async () => {
      const [outbox, bills] = await Promise.all([
        window.__qaReadStore("sync_outbox"),
        window.__qaReadStore("bills"),
      ]);
      const confirm = document.querySelector('[data-testid="button-confirm-bill"]');
      return {
        outboxOperations: outbox.map((row) => ({ operation: row.operation_type, status: row.status, error: row.error_message })),
        localBillCount: bills.length,
        confirmDisabled: confirm instanceof HTMLButtonElement ? confirm.disabled : null,
        customerName: document.querySelector('[data-testid="input-customer-name"]')?.value ?? null,
        customerMobile: document.querySelector('[data-testid="input-customer-mobile"]')?.value ?? null,
        databaseEvents: window.__qaDatabaseEvents ?? [],
        visibleText: document.body.innerText.slice(-1500),
      };
    }, null);
    if (!billWriteDiagnostic.outboxOperations.some((row) => row.operation === "CREATE_BILL")) {
      throw new Error(`Save Bill did not create an outbox operation: ${JSON.stringify(billWriteDiagnostic)}`);
    }
    const pending = await localSnapshot(client);
    if (pending.billEventStatus !== "PENDING" || pending.billEventSyncStatus !== "pending_sync") {
      throw new Error(`Offline bill did not remain pending: ${JSON.stringify(pending)}`);
    }
    if (pending.activeLedgerCount !== 1 || pending.activeLedgerTotal !== TEST_AMOUNT) {
      throw new Error(`Offline ledger was not exactly once: ${JSON.stringify(pending)}`);
    }

    await setOffline(client, false);
    await navigate(client, `${FRONTEND_URL}/sync-status`);
    await client.evaluateFunction(pageHelpers.install, null);
    await waitForPage(client, ({ text }) => [...document.querySelectorAll("button")].some((row) => row.textContent?.includes(text)), { text: "Force sync" }, 20_000);
    await client.evaluateFunction(pageHelpers.clickText, { selector: "button", text: "Force sync" });
    await waitForPage(client, async (eventId) => {
      const rows = await window.__qaReadStore("sync_outbox");
      const event = rows.find((row) => (row.clientEventId ?? row.op_id) === eventId);
      return event?.status === "SYNCED";
    }, pending.billEventId, 45_000);

    await navigate(client, `${FRONTEND_URL}/udhar`);
    await client.evaluateFunction(pageHelpers.install, null);
    await sleep(2_000);
    const synced = await localSnapshot(client, pending.billId);
    if (synced.activeLedgerCount !== 1 || synced.activeLedgerTotal !== TEST_AMOUNT) {
      throw new Error(`Synced local ledger was counted more than once: ${JSON.stringify(synced)}`);
    }

    const server = await client.evaluateFunction(async ({ apiUrl, customerName, amount }) => {
      const session = JSON.parse(localStorage.getItem("kiranaos.auth.session.v1") ?? "{}");
      const headers = {
        authorization: `Bearer ${session.accessToken}`,
        "x-device-id": localStorage.getItem("kirana-os:device-id:v1") ?? "",
      };
      const [ledgerResponse, customersResponse] = await Promise.all([
        fetch(`${apiUrl}/udhar?limit=500`, { headers }),
        fetch(`${apiUrl}/customers?limit=500`, { headers }),
      ]);
      const ledgerJson = await ledgerResponse.json();
      const customersJson = await customersResponse.json();
      const ledgerData = ledgerJson.data ?? ledgerJson;
      const customerData = customersJson.data ?? customersJson;
      const entries = Array.isArray(ledgerData.entries) ? ledgerData.entries : Array.isArray(ledgerData.ledger) ? ledgerData.ledger : [];
      const customers = Array.isArray(customerData) ? customerData : [];
      const customer = customers.find((row) => row.name === customerName);
      const matching = entries.filter((row) => row.customerId === customer?.id && row.type === "debit" && Math.abs(Number(row.amount) - amount) < 0.005);
      return {
        customerId: customer?.id ?? null,
        customerBalance: Number(customer?.udharAmount ?? 0),
        matchingLedgerCount: matching.length,
        matchingLedgerTotal: matching.reduce((sum, row) => sum + Number(row.amount ?? 0), 0),
        ledgerIds: matching.map((row) => row.id),
        clientLedgerIds: matching.map((row) => row.clientLedgerId ?? null),
      };
    }, { apiUrl: API_URL, customerName, amount: TEST_AMOUNT });
    if (server.customerBalance !== TEST_AMOUNT || server.matchingLedgerCount !== 1 || server.matchingLedgerTotal !== TEST_AMOUNT) {
      throw new Error(`Backend ledger was not exactly once: ${JSON.stringify(server)}`);
    }

    console.log(JSON.stringify({
      passed: true,
      scenario: "offline udhar bill -> pending outbox -> frontend Force sync -> pull reconciliation",
      amount: TEST_AMOUNT,
      pending,
      synced,
      server,
    }, null, 2));
  } finally {
    client?.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error?.stack ?? error);
  process.exitCode = 1;
});
