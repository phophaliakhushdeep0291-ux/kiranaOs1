import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = "http://localhost:5173";
const API_URL = "http://localhost:3000/api";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = 9471;
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

async function screenshot(client, name) {
  const image = await client.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  const file = path.join(tmpdir(), name);
  await writeFile(file, Buffer.from(image.data, "base64"));
  return file;
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), "kirana-mobile-ux-audit-"));
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
    if (!target) throw new Error("Browser target was not created");
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
    const productName = `Mobile UX Tea ${runId.slice(-4)}`;

    await navigate(client, `${FRONTEND_URL}/register`);
    await client.evaluate(`(async () => {
      const apiUrl = ${JSON.stringify(API_URL)};
      const response = await fetch(apiUrl + '/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-id': 'mobile_ux_audit_${runId}' },
        body: JSON.stringify({
          shopName: 'Mobile UX Audit',
          ownerName: 'KiranaOS QA',
          city: 'Delhi',
          address: 'Mobile UX audit lane',
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
    await waitForPage(client, "Boolean(document.querySelector('[data-testid=\"input-mobile\"]'))");
    await client.evaluate(`(() => {
      const setInputValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setInputValue(document.querySelector('[data-testid="input-mobile"]'), ${JSON.stringify(mobile)});
      setInputValue(document.querySelector('[data-testid="input-password"]'), 'Test@12345');
      document.querySelector('[data-testid="button-login"]').click();
      return true;
    })()`);
    await waitForPage(client, "Boolean(document.querySelector('#main-content'))", 30_000);

    const auditExpression = `(() => {
      const clipRect = (node) => {
        const rect = node.getBoundingClientRect();
        let top = Math.max(0, rect.top);
        let right = Math.min(innerWidth, rect.right);
        let bottom = Math.min(innerHeight, rect.bottom);
        let left = Math.max(0, rect.left);
        for (let parent = node.parentElement; parent; parent = parent.parentElement) {
          const style = getComputedStyle(parent);
          if (!/(auto|scroll|hidden|clip)/.test(style.overflow + style.overflowX + style.overflowY)) continue;
          const parentRect = parent.getBoundingClientRect();
          top = Math.max(top, parentRect.top);
          right = Math.min(right, parentRect.right);
          bottom = Math.min(bottom, parentRect.bottom);
          left = Math.max(left, parentRect.left);
        }
        return { top, right, bottom, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      };
      const visible = (node) => {
        const rect = node.getBoundingClientRect();
        const clipped = clipRect(node);
        const style = getComputedStyle(node);
        return rect.width > 1 && rect.height > 1 && clipped.width > 1 && clipped.height > 1 && style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0.01;
      };
      const rectObj = (node) => {
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        const style = getComputedStyle(node);
        return {
          tag: node.tagName.toLowerCase(),
          text: (node.textContent || node.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 100),
          position: style.position,
          zIndex: style.zIndex,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          className: String(node.className || '').slice(0, 120),
        };
      };
      const actionable = [...document.querySelectorAll('button,a,input,textarea,select,[role="button"],[role="combobox"]')]
        .filter(visible)
        .filter((node) => {
          const rect = clipRect(node);
          return rect.top >= 0 && rect.top < innerHeight && rect.bottom > innerHeight - 360;
        })
        .map((node) => {
          const rect = clipRect(node);
          const x = Math.max(1, Math.min(innerWidth - 1, rect.left + rect.width / 2));
          const y = Math.max(1, Math.min(innerHeight - 1, rect.top + rect.height / 2));
          const hit = document.elementFromPoint(x, y);
          const blocked = Boolean(hit && hit !== node && !node.contains(hit) && !hit.contains(node));
          return { ...rectObj(node), hitTag: hit?.tagName?.toLowerCase() || null, hitText: (hit?.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, 80), blocked };
        });
      return {
        url: location.href,
        viewport: [innerWidth, innerHeight],
        bodyText: document.body.innerText.split('\\n').slice(0, 50).join(' | '),
        panel: rectObj(document.querySelector('[aria-label="Add new product"]')),
        ownerDialog: rectObj([...document.querySelectorAll('[role="dialog"]')].find((node) => (node.textContent || '').includes('Owner approval') || (node.textContent || '').includes('Owner PIN'))),
        nav: rectObj(document.querySelector('nav[aria-label="Mobile navigation"]')),
        fixedOrStickyBottom: [...document.querySelectorAll('body *')].filter(visible).filter((node) => {
          const style = getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return ['fixed', 'sticky'].includes(style.position) && rect.bottom > innerHeight - 280;
        }).map(rectObj).slice(0, 12),
        actionable,
        blocked: actionable.filter((item) => item.blocked),
        runtimeErrors: window.__kiranaQaErrors || [],
      };
    })()`;

    await navigate(client, `${FRONTEND_URL}/products`);
    await waitForPage(client, "Boolean(document.querySelector('[data-testid=\"button-add-product\"]'))");
    const productsInitial = await client.evaluate(auditExpression);
    const productsInitialShot = await screenshot(client, "kirana-mobile-products-initial.png");

    await client.evaluate(`document.querySelector('[data-testid="button-add-product"]')?.click()`);
    await waitForPage(client, "Boolean(document.querySelector('[aria-label=\"Add new product\"]'))");
    await sleep(400);
    const productPanelOpen = await client.evaluate(auditExpression);
    const productPanelShot = await screenshot(client, "kirana-mobile-products-panel.png");

    await client.evaluate(`(() => {
      const setInputValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      const fieldInput = (labelText) => {
        const label = [...document.querySelectorAll('[id^="product-field-label-"]')].find((node) => (node.textContent || '').includes(labelText));
        return label?.closest('[role="group"]')?.querySelector('input, textarea');
      };
      setInputValue(fieldInput('Product Name'), ${JSON.stringify(productName)});
      setInputValue(fieldInput('MRP'), '30');
      setInputValue(fieldInput('Cost Price'), '20');
      setInputValue(fieldInput('Selling Price'), '25');
      setInputValue(fieldInput('Opening Stock'), '20');
      const scroller = document.querySelector('[aria-label="Add new product"] .app-scrollbar');
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      return true;
    })()`);
    await sleep(400);
    const productPanelBottom = await client.evaluate(auditExpression);

    await client.evaluate(`([...document.querySelectorAll('button')].find((button) => (button.textContent || '').includes('Save Product')))?.click()`);
    await waitForPage(client, "Boolean(document.querySelector('input[placeholder=\"Enter owner PIN\"]'))", 15_000);
    await sleep(400);
    const ownerPinOpen = await client.evaluate(auditExpression);
    const ownerPinShot = await screenshot(client, "kirana-mobile-owner-pin.png");
    await client.evaluate(`(() => {
      const setInputValue = (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      setInputValue(document.querySelector('input[placeholder="Enter owner PIN"]'), '2468');
      const button = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes('Create product'));
      button?.click();
      return Boolean(button);
    })()`);
    await waitForPage(client, `document.body.innerText.includes(${JSON.stringify(productName)}) && !document.querySelector('input[placeholder="Enter owner PIN"]')`, 30_000);
    const productCreated = await client.evaluate(`(() => ({
      textIncludesProduct: document.body.innerText.includes(${JSON.stringify(productName)}),
      toastText: [...document.querySelectorAll('[role="status"], [data-radix-toast-title]')].map((node) => node.textContent?.trim()).filter(Boolean).join(' | '),
      runtimeErrors: window.__kiranaQaErrors || [],
    }))()`);
    const productsDebugAfterCreate = await client.evaluate(`(async () => {
      const { offlineDB } = await import('/src/lib/offline/db.ts');
      const { getActiveLocationId } = await import('/src/features/core/stores/location-context.ts');
      const { readInstantCache } = await import('/src/lib/offline/instant-cache.ts');
      const locationId = getActiveLocationId();
      const rows = await offlineDB.getAll('products');
      return {
        locationId,
        dbCount: rows.length,
        dbMatches: rows.filter((row) => String(row.name || '').includes(${JSON.stringify(productName)})).map((row) => ({ id: row.id, name: row.name, locationId: row.inventoryLocationId, sync: row.sync_status })),
        plainCacheCount: readInstantCache('products', []).length,
        scopedCacheCount: readInstantCache('products:' + (locationId || 'company'), []).length,
        plainCacheMatches: readInstantCache('products', []).filter((row) => String(row.name || '').includes(${JSON.stringify(productName)})).map((row) => row.name),
        scopedCacheMatches: readInstantCache('products:' + (locationId || 'company'), []).filter((row) => String(row.name || '').includes(${JSON.stringify(productName)})).map((row) => row.name),
      };
    })()`);

    await navigate(client, `${FRONTEND_URL}/billing`);
    await waitForPage(client, "Boolean(document.querySelector('[data-testid=\"input-product-search\"]'))");
    const productsDebugOnBilling = await client.evaluate(`(async () => {
      const { offlineDB } = await import('/src/lib/offline/db.ts');
      const { getActiveLocationId } = await import('/src/features/core/stores/location-context.ts');
      const { readInstantCache } = await import('/src/lib/offline/instant-cache.ts');
      const locationId = getActiveLocationId();
      const rows = await offlineDB.getAll('products');
      return {
        locationId,
        dbCount: rows.length,
        dbMatches: rows.filter((row) => String(row.name || '').includes(${JSON.stringify(productName)})).map((row) => ({ id: row.id, name: row.name, locationId: row.inventoryLocationId, sync: row.sync_status })),
        plainCacheCount: readInstantCache('products', []).length,
        scopedCacheCount: readInstantCache('products:' + (locationId || 'company'), []).length,
        plainCacheMatches: readInstantCache('products', []).filter((row) => String(row.name || '').includes(${JSON.stringify(productName)})).map((row) => row.name),
        scopedCacheMatches: readInstantCache('products:' + (locationId || 'company'), []).filter((row) => String(row.name || '').includes(${JSON.stringify(productName)})).map((row) => row.name),
      };
    })()`);
    await client.evaluate(`(() => {
      const input = document.querySelector('[data-testid="input-product-search"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter.call(input, ${JSON.stringify(productName)});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`);
    await sleep(900);
    const billingSearch = await client.evaluate(auditExpression);
    const clickedBillingCard = await client.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find((node) => (node.textContent || '').includes(${JSON.stringify(productName)}));
      button?.click();
      return Boolean(button);
    })()`);
    await sleep(600);
    const billingAfterAdd = await client.evaluate(auditExpression);
    const billingShot = await screenshot(client, "kirana-mobile-billing-after-product.png");

    console.log(JSON.stringify({
      productName,
      screenshots: { productsInitialShot, productPanelShot, ownerPinShot, billingShot },
      productsInitial,
      productPanelOpen,
      productPanelBottom,
      ownerPinOpen,
      productCreated,
      productsDebugAfterCreate,
      productsDebugOnBilling,
      billingSearch,
      clickedBillingCard,
      billingAfterAdd,
    }, null, 2));
  } finally {
    client?.close();
    chrome.kill();
  }
}

await main();
