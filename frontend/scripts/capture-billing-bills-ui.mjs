import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.QA_FRONTEND_URL || "http://localhost:5173";
const API_URL = process.env.QA_API_URL || "http://localhost:3000/api";
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.QA_DEBUG_PORT || 9452);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
  }
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
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }
  close() {
    this.socket?.close();
  }
}

async function waitFor(url, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // App is still starting.
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPage(client, expression, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await client.evaluate(expression)) return;
    await sleep(150);
  }
  const diagnostic = await client.evaluate(`({ url: location.href, text: document.body?.innerText?.slice(0, 1200), errors: window.__kiranaQaErrors || [] })`).catch(() => null);
  throw new Error(`Timed out waiting for page condition: ${expression}; page=${JSON.stringify(diagnostic)}`);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitForPage(client, "document.readyState === 'complete'");
}

async function capture(client, file, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 640,
  });
  await sleep(900);
  const metrics = await client.evaluate(`(() => {
    const body = document.body;
    const doc = document.documentElement;
    return {
      viewport: [innerWidth, innerHeight],
      bodyWidth: body.scrollWidth,
      documentWidth: doc.scrollWidth,
      bodyHeight: body.scrollHeight,
      title: document.body.innerText.split('\\n').slice(0, 8).join(' | '),
    };
  })()`);
  if (metrics.documentWidth > width + 2 || metrics.bodyWidth > width + 2) {
    throw new Error(`${file} has horizontal overflow: ${JSON.stringify(metrics)}`);
  }
  const image = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(path.resolve(file), Buffer.from(image.data, "base64"));
  return metrics;
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function main() {
  console.log("visual-qa: creating Chrome profile");
  const profile = await mkdtemp(path.join(tmpdir(), "kirana-billing-bills-ui-"));
  console.log("visual-qa: starting Chrome", { DEBUG_PORT, profile });
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
    chrome.on("error", (error) => console.error("visual-qa: chrome spawn error", error));
    console.log("visual-qa: waiting for CDP");
    await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    console.log("visual-qa: CDP ready");
    let target;
    for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
      if (attempt % 10 === 0) console.log("visual-qa: target lookup", attempt);
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      target = targets.find((item) => item.type === "page" && item.url.startsWith(FRONTEND_URL));
      if (!target) await sleep(100);
    }
    if (!target) throw new Error("Billing/Bills browser target was not created");
    console.log("visual-qa: target ready", target.url);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__kiranaQaErrors = [];
        window.addEventListener('error', (event) => window.__kiranaQaErrors.push(String(event.error?.stack || event.message || event.error)));
        window.addEventListener('unhandledrejection', (event) => window.__kiranaQaErrors.push(String(event.reason?.stack || event.reason)));
      `,
    });
    await navigate(client, `${FRONTEND_URL}/register`);

    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const mobile = `9${runId.slice(-9)}`;
    await client.evaluate(`(async () => {
      const apiUrl = ${JSON.stringify(API_URL)};
      const runId = ${JSON.stringify(runId)};
      const deviceId = localStorage.getItem('kiranaos_device_id') || localStorage.getItem('kirana-os:device-id:v1') || ('billing_bills_ui_' + runId);
      const response = await fetch(apiUrl + '/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
        body: JSON.stringify({
          shopName: 'Billing Bills UI QA',
          ownerName: 'KiranaOS QA',
          city: 'Jodhpur',
          address: 'Visual QA',
          mobile: ${JSON.stringify(mobile)},
          password: 'Test@12345',
          ownerPin: '2468'
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(json));
      const auth = json.data ?? json;
      localStorage.setItem('kiranaApiBaseUrl', apiUrl);
      localStorage.setItem('kiranaos_device_id', deviceId);
      localStorage.setItem('kirana-os:device-id:v1', deviceId);
      localStorage.setItem('kiranaos.auth.session.v1', JSON.stringify({
        accessToken: auth.accessToken ?? auth.token,
        refreshToken: auth.refreshToken,
        user: auth.user,
        shop: auth.shop,
      }));
      const productResponse = await fetch(apiUrl + '/products', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + (auth.accessToken ?? auth.token),
          'x-device-id': deviceId,
          'x-owner-pin': '2468',
        },
        body: JSON.stringify({
          name: 'QA Atta 5kg', category: 'Grocery', displayUnit: 'bag', baseUnit: 'bag', rateUnit: 'bag',
          stockBaseQty: 24, costPerRateUnit: 232, minPricePerRateUnit: 250,
          defaultPricePerRateUnit: 265, mrp: 280, gstRate: 5, lowStockThreshold: 8,
        }),
      });
      if (!productResponse.ok) throw new Error('Product seed failed: ' + await productResponse.text());
      await import('/src/features/demo/demo-shop-data.ts').then((module) => module.seedDemoShopData());
      return true;
    })()`);

    await client.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await navigate(client, `${FRONTEND_URL}/billing?billType=normal_sale`);
    await waitForPage(client, "document.body.innerText.includes('QA Atta 5kg')");
    await client.evaluate(`(() => {
      const card = document.querySelector('[data-testid^="product-card-"]');
      if (!card) throw new Error('Product card was not rendered');
      card.click();
      return true;
    })()`);
    await waitForPage(client, "document.body.innerText.includes('Billing') && document.querySelector('[data-testid=\"button-confirm-bill\"]') && !document.querySelector('[data-testid=\"button-confirm-bill\"]').textContent.includes('Estimate')");
    await sleep(1_200);
    const billingAudit = await client.evaluate(`(() => {
      const panel = document.querySelector('[data-testid="bill-summary-panel"]');
      const primarySaveText = document.querySelector('[data-testid="button-confirm-bill"]')?.textContent ?? '';
      const typeButtons = [
        document.querySelector('[data-testid="button-bill-type-pakka"]'),
        document.querySelector('[data-testid="button-bill-type-estimate"]'),
      ].filter(Boolean);
      const rects = typeButtons.slice(0, 2).map((node) => {
        const rect = node.getBoundingClientRect();
        return { width: Math.round(rect.width), height: Math.round(rect.height), top: Math.round(rect.top), left: Math.round(rect.left) };
      });
      const panelRect = panel?.getBoundingClientRect();
      return {
        hasPakkaAction: primarySaveText.includes('Collect') || primarySaveText.includes('Record') || primarySaveText.includes('Save Pakka Bill'),
        hasEstimateSave: primarySaveText.includes('Save Estimate'),
        rects,
        panelWidth: panelRect ? Math.round(panelRect.width) : 0,
        summaryOverflow: panel ? panel.scrollWidth - panel.clientWidth : 0,
      };
    })()`);
    assert(billingAudit.hasPakkaAction, `Billing primary action did not show a Pakka payment/save action: ${JSON.stringify(billingAudit)}`);
    assert(!billingAudit.hasEstimateSave, `Normal billing leaked estimate save text: ${JSON.stringify(billingAudit)}`);
    assert(billingAudit.rects.length >= 2, `Bill type selector missing: ${JSON.stringify(billingAudit)}`);
    assert(Math.abs(billingAudit.rects[0].width - billingAudit.rects[1].width) <= 4, `Bill type selector columns uneven: ${JSON.stringify(billingAudit)}`);
    assert(billingAudit.summaryOverflow <= 2, `Billing summary overflowed: ${JSON.stringify(billingAudit)}`);
    const billingDesktop = await capture(client, "billing-desktop.png", 1440, 900);

    await navigate(client, `${FRONTEND_URL}/billing?billType=estimate`);
    await waitForPage(client, "document.querySelector('[data-testid=\"button-confirm-bill\"]')?.textContent.includes('Save Estimate Bill')");
    await sleep(900);
    const estimateAudit = await client.evaluate(`(() => ({
      primarySaveText: document.querySelector('[data-testid="button-confirm-bill"]')?.textContent ?? '',
      hasEstimateSave: (document.querySelector('[data-testid="button-confirm-bill"]')?.textContent ?? '').includes('Save Estimate Bill'),
      hasPakkaSave: (document.querySelector('[data-testid="button-confirm-bill"]')?.textContent ?? '').includes('Save Pakka Bill'),
      paymentVisible: document.body.innerText.includes('Payment Method'),
      noPaymentSaved: document.body.innerText.includes('No payment saved'),
    }))()`);
    assert(estimateAudit.hasEstimateSave, `Estimate billing did not switch copy: ${JSON.stringify(estimateAudit)}`);
    assert(estimateAudit.paymentVisible, `Estimate payment panel was not rendered: ${JSON.stringify(estimateAudit)}`);
    const estimateDesktop = await capture(client, "billing-estimate-desktop.png", 1440, 900);

    await navigate(client, `${FRONTEND_URL}/bills`);
    await waitForPage(client, "document.body.innerText.includes('Billing History') && document.body.innerText.includes('Pakka Bills') && document.body.innerText.includes('Estimates')");
    await sleep(1_200);
    const billsAudit = await client.evaluate(`(() => {
      const table = document.querySelector('#billing-history-table table');
      const cards = [...document.querySelectorAll('article')].map((node) => Math.round(node.getBoundingClientRect().height));
      const tabs = ['All Bills','Pakka Bills','Estimates','Paid','Partial','Udhar','Cancelled'].every((label) => document.body.innerText.includes(label));
      const firstRow = table ? table.querySelector('tbody tr') : null;
      const bodyText = document.body.innerText;
      return {
        hasTabs: tabs,
        hasTable: Boolean(table),
        hasRows: Boolean(firstRow) || bodyText.includes('No bills found'),
        cardHeights: cards.slice(0, 6),
        rowsText: bodyText.includes('Showing 1 to') || bodyText.includes('No bills found'),
      };
    })()`);
    assert(billsAudit.hasTabs, `Bills tabs missing: ${JSON.stringify(billsAudit)}`);
    assert(billsAudit.hasRows, `Bills table/empty state missing: ${JSON.stringify(billsAudit)}`);
    const billsDesktop = await capture(client, "bills-desktop.png", 1440, 900);
    const billsMobile = await capture(client, "bills-mobile.png", 390, 844);

    const runtimeErrors = await client.evaluate("window.__kiranaQaErrors || []");
    assert(runtimeErrors.length === 0, `Browser runtime errors: ${runtimeErrors.join(" | ")}`);
    console.log(JSON.stringify({
      billingAudit,
      estimateAudit,
      billsAudit,
      billingDesktop,
      estimateDesktop,
      billsDesktop,
      billsMobile,
      runtimeErrors,
    }, null, 2));
  } finally {
    client?.close();
    chrome.kill();
  }
}

try {
  await main();
} catch (error) {
  console.error(error.stack ?? error);
  process.exitCode = 1;
}
