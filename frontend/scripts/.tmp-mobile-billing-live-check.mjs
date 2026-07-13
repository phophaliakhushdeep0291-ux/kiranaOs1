import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = "http://localhost:5173";
const API_URL = "http://localhost:3000/api";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = 9467;
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
    } catch {}
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
  throw new Error(`Timed out waiting for page condition: ${expression}`);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitForPage(client, "document.readyState === 'complete'");
}

function assert(value, message) {
  if (!value) throw new Error(message);
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), "kirana-mobile-billing-live-"));
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
    await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    let target;
    for (let attempt = 0; attempt < 80 && !target; attempt += 1) {
      const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
      target = targets.find((item) => item.type === "page" && item.url.startsWith(FRONTEND_URL));
      if (!target) await sleep(100);
    }
    assert(target, "Browser target was not created");
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        window.__kiranaQaErrors = [];
        window.addEventListener('error', (event) => window.__kiranaQaErrors.push(String(event.error?.stack || event.message || event.error)));
        window.addEventListener('unhandledrejection', (event) => window.__kiranaQaErrors.push(String(event.reason?.stack || event.reason)));
      `,
    });

    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const mobile = `9${runId.slice(-9)}`;
    await navigate(client, `${FRONTEND_URL}/register`);
    await client.evaluate(`(async () => {
      const apiUrl = ${JSON.stringify(API_URL)};
      const runId = ${JSON.stringify(runId)};
      const response = await fetch(apiUrl + '/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-id': 'mobile_billing_live_' + runId },
        body: JSON.stringify({
          shopName: 'Mobile Billing Live QA',
          ownerName: 'KiranaOS QA',
          city: 'Delhi',
          address: 'Mobile live QA lane',
          mobile: ${JSON.stringify(mobile)},
          password: 'Test@12345',
          ownerPin: '2468'
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(json));
      localStorage.setItem('kiranaApiBaseUrl', apiUrl);
      return true;
    })()`);

    await navigate(client, `${FRONTEND_URL}/login`);
    await waitForPage(client, "Boolean(document.querySelector('[data-testid=\"input-mobile\"]') && document.querySelector('[data-testid=\"input-password\"]'))");
    await client.evaluate(`(() => {
      const setInputValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
      };
      setInputValue(document.querySelector('[data-testid="input-mobile"]'), ${JSON.stringify(mobile)});
      setInputValue(document.querySelector('[data-testid="input-password"]'), 'Test@12345');
      document.querySelector('[data-testid="button-login"]').click();
      return true;
    })()`);
    await waitForPage(client, "Boolean(document.querySelector('#main-content') || document.body.innerText.includes('Open profile'))", 30_000);
    await client.evaluate(`(async () => {
      const demo = await import('/src/features/demo/demo-shop-data.ts');
      await demo.seedDemoShopData();
      const { offlineDB } = await import('/src/lib/offline/db.ts');
      const product = {
        id: 'qa-live-sugar',
        productId: 'qa-live-sugar',
        name: 'Live QA Sugar',
        category: 'Grocery',
        aliases: ['sugar'],
        displayUnit: 'kg',
        unit: 'kg',
        baseUnit: 'kg',
        rateUnit: 'kg',
        stockBaseQty: 25,
        stockQuantity: 25,
        stockUnit: 'kg',
        stockTrackingEnabled: true,
        costPerRateUnit: 28,
        minPricePerRateUnit: 30,
        defaultPricePerRateUnit: 42,
        sellingPrice: 42,
        retailPrice: 42,
        wholesalePrice: 40,
        mrp: 45,
        gstRate: 0,
        deletedAt: null,
        sellingUnits: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await offlineDB.setSetting('kirana-os:billing-draft:v1', {
        activeBillId: 'qa-live-bill',
        cart: [{ product, quantity: 1, rate: 42, unit: 'kg' }],
        discount: 0,
        paymentMode: 'cash',
        billType: 'normal_sale',
        selectedCustomerId: 'walk_in',
        customerName: '',
        customerMobile: '',
        paidAmount: '',
        splitCashAmount: '',
        splitUpiAmount: '',
        allowAdvancePayment: false,
      });
      return true;
    })()`);
    await client.send("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        (() => {
          const product = {
            id: 'qa-live-sugar',
            productId: 'qa-live-sugar',
            name: 'Live QA Sugar',
            category: 'Grocery',
            aliases: ['sugar'],
            displayUnit: 'kg',
            unit: 'kg',
            baseUnit: 'kg',
            rateUnit: 'kg',
            stockBaseQty: 25,
            stockQuantity: 25,
            stockUnit: 'kg',
            stockTrackingEnabled: true,
            costPerRateUnit: 28,
            minPricePerRateUnit: 30,
            defaultPricePerRateUnit: 42,
            sellingPrice: 42,
            retailPrice: 42,
            wholesalePrice: 40,
            mrp: 45,
            gstRate: 0,
            deletedAt: null,
            sellingUnits: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          const originalFetch = window.fetch.bind(window);
          window.fetch = async (input, init) => {
            const url = typeof input === 'string' ? input : input?.url || '';
            if (/\\/api\\/products(?:\\?|$)/.test(url)) {
              return new Response(JSON.stringify({ success: true, data: [product] }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
              });
            }
            return originalFetch(input, init);
          };
        })();
      `,
    });
    await navigate(client, `${FRONTEND_URL}/billing`);
    await waitForPage(client, "Boolean(document.querySelector('#main-content') && document.body.innerText.length > 200)");
    await sleep(1_500);

    const beforeAdd = await client.evaluate(`(() => ({
      url: location.href,
      text: document.body.innerText.split('\\n').slice(0, 30).join(' | '),
      viewport: [innerWidth, innerHeight],
      nav: Boolean(document.querySelector('nav[aria-label="Mobile navigation"]')),
    }))()`);

    const addResult = await client.evaluate(`(() => {
      const candidates = [...document.querySelectorAll('button')].filter((button) => {
        const text = (button.textContent || '').trim();
        const rect = button.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !button.disabled && /^Add$|Add /i.test(text);
      });
      const button = candidates[0];
      if (!button) return { clicked: false, count: candidates.length };
      button.click();
      return { clicked: true, text: button.textContent?.trim() || '', count: candidates.length };
    })()`);
    await sleep(800);

    const report = await client.evaluate(`(() => {
      const main = document.querySelector('#main-content');
      if (main) main.scrollTop = main.scrollHeight;
      window.scrollTo(0, document.documentElement.scrollHeight);
      const isVisible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0.01;
      };
      const rectObj = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          tag: node.tagName.toLowerCase(),
          text: (node.textContent || node.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 90),
          position: style.position,
          zIndex: style.zIndex,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          className: String(node.className || '').slice(0, 140),
        };
      };
      const fixedBottom = [...document.querySelectorAll('body *')]
        .filter((node) => isVisible(node))
        .filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return ['fixed', 'sticky'].includes(style.position) && rect.bottom > innerHeight - 260;
        })
        .map(rectObj)
        .sort((a, b) => a.top - b.top);
      const actionable = [...document.querySelectorAll('button,a,input,select,textarea,[role="button"]')]
        .filter((node) => isVisible(node))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top >= 0 && rect.top < innerHeight && rect.bottom > innerHeight - 260;
        })
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
          const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
          const hit = document.elementFromPoint(x, y);
          const blocked = Boolean(hit && hit !== node && !node.contains(hit) && !hit.contains(node));
          return { ...rectObj(node), hitTag: hit?.tagName?.toLowerCase() || null, hitText: (hit?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80), blocked };
        });
      const blocked = actionable.filter((item) => item.blocked);
      const nav = rectObj(document.querySelector('nav[aria-label="Mobile navigation"]'));
      const checkout = fixedBottom.find((item) => item.text.includes('Review') || item.text.includes('Checkout') || item.text.includes('₹')) || null;
      return {
        url: location.href,
        viewport: [innerWidth, innerHeight],
        main: main ? { clientHeight: main.clientHeight, scrollHeight: main.scrollHeight, scrollTop: main.scrollTop, paddingBottom: getComputedStyle(main).paddingBottom } : null,
        bodyText: document.body.innerText.split('\\n').slice(0, 35).join(' | '),
        nav,
        checkout,
        fixedBottom,
        actionable,
        blocked,
        runtimeErrors: window.__kiranaQaErrors || [],
      };
    })()`);

    const image = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(path.resolve("billing-mobile-live.png"), Buffer.from(image.data, "base64"));
    await client.evaluate(`document.querySelector('[data-testid="mobile-save-bill"]')?.click()`);
    await sleep(700);
    const checkoutReport = await client.evaluate(`(() => {
      const isVisible = (node) => {
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none' && Number(style.opacity || 1) > 0.01;
      };
      const rectObj = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          tag: node.tagName.toLowerCase(),
          text: (node.textContent || node.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 110),
          position: style.position,
          zIndex: style.zIndex,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          className: String(node.className || '').slice(0, 140),
        };
      };
      const fixedBottom = [...document.querySelectorAll('body *')]
        .filter((node) => isVisible(node))
        .filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return ['fixed', 'sticky'].includes(style.position) && rect.bottom > innerHeight - 320;
        })
        .map(rectObj)
        .sort((a, b) => a.top - b.top);
      const actionable = [...document.querySelectorAll('button,a,input,select,textarea,[role="button"]')]
        .filter((node) => isVisible(node))
        .filter((node) => {
          const rect = node.getBoundingClientRect();
          return rect.top >= 0 && rect.top < innerHeight && rect.bottom > innerHeight - 360;
        })
        .map((node) => {
          const rect = node.getBoundingClientRect();
          const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
          const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
          const hit = document.elementFromPoint(x, y);
          const blocked = Boolean(hit && hit !== node && !node.contains(hit) && !hit.contains(node));
          return { ...rectObj(node), hitTag: hit?.tagName?.toLowerCase() || null, hitText: (hit?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80), blocked };
        });
      return {
        bodyText: document.body.innerText.split('\\n').slice(-45).join(' | '),
        dialog: rectObj(document.querySelector('[role="dialog"]')),
        nav: rectObj(document.querySelector('nav[aria-label="Mobile navigation"]')),
        fixedBottom,
        actionable,
        blocked: actionable.filter((item) => item.blocked),
      };
    })()`);
    const checkoutImage = await client.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
      captureBeyondViewport: false,
    });
    await writeFile(path.resolve("billing-mobile-checkout-live.png"), Buffer.from(checkoutImage.data, "base64"));
    console.log(JSON.stringify({ beforeAdd, addResult, report, checkoutReport }, null, 2));
  } finally {
    client?.close();
    chrome.kill();
  }
}

await main();
