import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = "http://localhost:5173";
const API_URL = "http://localhost:3000/api";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = 9445;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket?.close(); }
}

async function waitFor(url, timeout = 20_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* starting */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPage(client, expression, timeout = 25_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await client.evaluate(expression)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for: ${expression}`);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitForPage(client, "document.readyState === 'complete'");
}

async function clickButton(client, label) {
  const count = await client.evaluate(`(() => {
    const buttons = [...document.querySelectorAll('button')]
      .filter((button) => button.offsetParent !== null && button.textContent?.trim() === ${JSON.stringify(label)});
    buttons[0]?.click();
    return buttons.length;
  })()`);
  if (count === 0) throw new Error(`Button not found: ${label}`);
}

async function capture(client, file, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await sleep(700);
  const metrics = await client.evaluate(`(() => ({
    viewport: [innerWidth, innerHeight],
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
    returnRows: document.querySelectorAll('tbody tr').length,
    metricCards: [...document.querySelectorAll('article')].filter((node) => /Total Returns|Return Orders|Items Returned|Refund Amount|Credit Issued/.test(node.innerText)).length,
  }))()`);
  if (metrics.documentWidth > width || metrics.bodyWidth > width) {
    throw new Error(`${file} overflows horizontally: ${JSON.stringify(metrics)}`);
  }
  const image = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.resolve(file), Buffer.from(image.data, "base64"));
  return metrics;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), "kirana-returns-ui-"));
  const chrome = spawn(CHROME_PATH, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, `${FRONTEND_URL}/register`,
  ], { windowsHide: true, stdio: "ignore" });
  let client;
  try {
    await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    const target = targets.find((item) => item.type === "page" && item.url.startsWith(FRONTEND_URL));
    if (!target) throw new Error("Return-page browser target was not created");
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__kiranaQaErrors = [];
      window.addEventListener('error', (event) => window.__kiranaQaErrors.push(String(event.error?.stack || event.message || event.error)));
      window.addEventListener('unhandledrejection', (event) => window.__kiranaQaErrors.push(String(event.reason?.stack || event.reason)));
    ` });
    await navigate(client, `${FRONTEND_URL}/register`);

    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const mobile = `9${runId.slice(-9)}`;
    await client.evaluate(`(async () => {
      const apiUrl = ${JSON.stringify(API_URL)};
      const runId = ${JSON.stringify(runId)};
      const response = await fetch(apiUrl + '/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-id': 'returns_ui_' + runId },
        body: JSON.stringify({ shopName: 'Returns UI QA', ownerName: 'KiranaOS QA', city: 'Jodhpur', address: 'Visual QA', mobile: ${JSON.stringify(mobile)}, password: 'Test@12345', ownerPin: '2468' }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(json));
      const auth = json.data ?? json;
      localStorage.setItem('kiranaApiBaseUrl', apiUrl);
      localStorage.setItem('kirana-os:device-id:v1', 'returns_ui_' + runId);
      localStorage.setItem('kiranaos.auth.session.v1', JSON.stringify({ accessToken: auth.accessToken ?? auth.token, refreshToken: auth.refreshToken, user: auth.user, shop: auth.shop }));
      const { offlineDB } = await import('/src/lib/offline/db.ts');
      const now = new Date();
      const iso = (daysAgo, hour) => { const value = new Date(now); value.setDate(value.getDate() - daysAgo); value.setHours(hour, 15, 0, 0); return value.toISOString(); };
      const bills = [
        { id: 'qa_return_cash', billNo: 'RET-2024-00048', billNumber: 'RET-2024-00048', billType: 'sales_return', returnOfBillId: 'INV-2024-01562', customerName: 'Ramesh Sharma', customerMobile: '9988776655', grandTotal: -100, totalAmount: -100, paidAmount: -100, refundMode: 'cash', paymentMode: 'cash', status: 'confirmed', sync_status: 'synced', createdAt: iso(0, 10) },
        { id: 'qa_return_upi', billNo: 'RET-2024-00047', billNumber: 'RET-2024-00047', billType: 'sales_return', returnOfBillId: 'INV-2024-01558', customerName: 'Suresh Kumar', customerMobile: '9876543210', grandTotal: -80, totalAmount: -80, paidAmount: -80, refundMode: 'upi', paymentMode: 'upi', status: 'confirmed', sync_status: 'synced', createdAt: iso(1, 9) },
        { id: 'qa_return_udhar', billNo: 'RET-2024-00046', billNumber: 'RET-2024-00046', billType: 'sales_return', returnOfBillId: 'INV-2024-01550', customerName: 'Pooja Meena', customerMobile: '9001234567', grandTotal: -120, totalAmount: -120, paidAmount: 0, creditAmount: -120, refundMode: 'udhar', paymentMode: 'udhar', status: 'confirmed', sync_status: 'synced', createdAt: iso(2, 15) },
      ];
      const items = [
        { id: 'qa_return_item_cash', billId: 'qa_return_cash', bill_id: 'qa_return_cash', productId: 'qa_product_salt', name: 'Tata Salt 1kg', category: 'Salt & Spices', quantity: -1, ratePerRateUnit: 100, lineTotal: -100, createdAt: iso(0, 10), sync_status: 'synced' },
        { id: 'qa_return_item_upi', billId: 'qa_return_upi', bill_id: 'qa_return_upi', productId: 'qa_product_surf', name: 'Surf Excel Matic 1kg', category: 'Detergents', quantity: -1, ratePerRateUnit: 80, lineTotal: -80, createdAt: iso(1, 9), sync_status: 'synced' },
        { id: 'qa_return_item_udhar', billId: 'qa_return_udhar', bill_id: 'qa_return_udhar', productId: 'qa_product_oil', name: 'Fortune Sunlite Oil 1L', category: 'Oil & Ghee', quantity: -2, ratePerRateUnit: 60, lineTotal: -120, createdAt: iso(2, 15), sync_status: 'synced' },
      ];
      await offlineDB.putMany('bills', bills);
      await offlineDB.putMany('bill_items', items);
      return true;
    })()`);

    await navigate(client, `${FRONTEND_URL}/returns`);
    await waitForPage(client, "document.body.innerText.includes('Return Orders') && document.body.innerText.includes('RET-2024-00048')");
    await sleep(1_000);
    const audit = await client.evaluate(`(() => {
      const cards = [...document.querySelectorAll('article')].map((article) => article.innerText.replace(/\\s+/g, ' ').trim());
      const card = (label) => cards.find((text) => text.startsWith(label)) || '';
      const text = document.body.innerText;
      return {
        total: card('Total Returns'), orders: card('Return Orders'), items: card('Items Returned'),
        refund: card('Refund Amount'), credit: card('Credit Issued'),
        hasCash: text.includes('Cash'), hasUpi: text.includes('UPI'), hasUdhar: text.includes('Credit (Udhar)'),
        returnIds: ['RET-2024-00048', 'RET-2024-00047', 'RET-2024-00046'].filter((id) => text.includes(id)).length,
        areaFills: [...document.querySelectorAll('.recharts-area-area')].filter((path) => !['none', 'transparent', null].includes(path.getAttribute('fill'))).length,
      };
    })()`);
    assert(/300/.test(audit.total), `Total returns mismatch: ${audit.total}`);
    assert(/3/.test(audit.orders), `Return order count mismatch: ${audit.orders}`);
    assert(/4/.test(audit.items), `Returned item count mismatch: ${audit.items}`);
    assert(/180/.test(audit.refund), `Refund amount mismatch: ${audit.refund}`);
    assert(/120/.test(audit.credit), `Credit amount mismatch: ${audit.credit}`);
    assert(audit.hasCash && audit.hasUpi && audit.hasUdhar, `Missing refund modes: ${JSON.stringify(audit)}`);
    assert(audit.returnIds === 3, `Missing return rows: ${JSON.stringify(audit)}`);
    assert(audit.areaFills >= 5, `Expected five colored KPI sparklines, got ${audit.areaFills}`);

    const desktop = await capture(client, "returns-desktop.png", 1680, 980);
    await clickButton(client, "New Return");
    await waitForPage(client, "document.body.innerText.includes('New sales return') && document.body.innerText.includes('Continue to refund')");
    await clickButton(client, "Cancel");
    const mobileMetrics = await capture(client, "returns-mobile.png", 390, 844);
    const runtimeErrors = await client.evaluate("window.__kiranaQaErrors || []");
    assert(runtimeErrors.length === 0, `Browser runtime errors: ${runtimeErrors.join(' | ')}`);
    console.log(JSON.stringify({ audit, desktop, mobile: mobileMetrics, runtimeErrors }, null, 2));
  } finally {
    client?.close();
    chrome.kill();
  }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
