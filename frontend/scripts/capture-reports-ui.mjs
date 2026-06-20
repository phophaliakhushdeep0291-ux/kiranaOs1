import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = "http://localhost:5173";
const API_URL = "http://localhost:3000/api";
const CHROME_PATH = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = 9444;

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

async function waitFor(url, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const response = await fetch(url); if (response.ok) return response; } catch { /* starting */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPage(client, expression, timeout = 25_000) {
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

async function screenshot(client, output, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
  await sleep(500);
  const metrics = await client.evaluate(`(() => {
    const main = document.querySelector('#main-content');
    return {
      viewport: [innerWidth, innerHeight],
      mainClientHeight: main?.clientHeight ?? null,
      mainScrollHeight: main?.scrollHeight ?? null,
      pageWidth: document.documentElement.scrollWidth,
      pageHeight: document.documentElement.scrollHeight,
      cards: document.querySelectorAll('article').length,
    };
  })()`);
  const image = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(output, Buffer.from(image.data, "base64"));
  return metrics;
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), "kirana-reports-ui-"));
  const chrome = spawn(CHROME_PATH, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, `${FRONTEND_URL}/register`,
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
    if (!target) throw new Error("Reports browser target was not created");
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await navigate(client, `${FRONTEND_URL}/register`);

    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const mobile = `9${runId.slice(-9)}`;
    const setup = await client.evaluate(`(async () => {
      const apiUrl = ${JSON.stringify(API_URL)};
      const runId = ${JSON.stringify(runId)};
      const response = await fetch(apiUrl + '/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-id': 'reports_ui_' + runId },
        body: JSON.stringify({ shopName: 'Reports UI QA', ownerName: 'KiranaOS QA', city: 'Jodhpur', address: 'Visual QA', mobile: ${JSON.stringify(mobile)}, password: 'Test@12345', ownerPin: '2468' }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(json));
      const auth = json.data ?? json;
      localStorage.setItem('kiranaApiBaseUrl', apiUrl);
      localStorage.setItem('kirana-os:device-id:v1', 'reports_ui_' + runId);
      localStorage.setItem('kiranaos.auth.session.v1', JSON.stringify({ accessToken: auth.accessToken ?? auth.token, refreshToken: auth.refreshToken, user: auth.user, shop: auth.shop }));
      await import('/src/features/demo/demo-shop-data.ts').then((module) => module.seedDemoShopData());
      return { shopId: auth.shop?.id };
    })()`);
    await navigate(client, `${FRONTEND_URL}/reports`);
    await waitForPage(client, "document.body.innerText.includes('Sales Trend') && document.querySelectorAll('article').length >= 10");
    await sleep(1_500);
    await client.evaluate(`(() => {
      const candidates = [...document.querySelectorAll('div')]
        .filter((element) => element.textContent?.includes("You're exploring with sample data") && element.textContent?.includes('Clear & start fresh'))
        .sort((a, b) => (a.textContent?.length ?? 0) - (b.textContent?.length ?? 0));
      if (candidates[0]) candidates[0].style.display = 'none';
      return Boolean(candidates[0]);
    })()`);

    const desktop = await screenshot(client, path.resolve("reports-desktop.png"), 1680, 980);
    const mobileMetrics = await screenshot(client, path.resolve("reports-mobile.png"), 390, 844);
    console.log(JSON.stringify({ setup, desktop, mobile: mobileMetrics }, null, 2));
  } finally {
    client?.close();
    chrome.kill();
  }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
