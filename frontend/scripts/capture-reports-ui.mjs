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
  const diagnostic = await client.evaluate("({ url: location.href, text: document.body?.innerText?.slice(0, 1600), articles: document.querySelectorAll('article').length, errors: window.__kiranaQaErrors || [] })").catch(() => null);
  throw new Error(`Timed out waiting for page condition: ${expression}; page=${JSON.stringify(diagnostic)}`);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitForPage(client, "document.readyState === 'complete'");
}

async function clickVisibleButton(client, label, index = 0) {
  const clicked = await client.evaluate(`(() => {
    const matches = [...document.querySelectorAll('button')]
      .filter((button) => button.offsetParent !== null && button.textContent?.trim() === ${JSON.stringify(label)});
    matches[${index}]?.click();
    return matches.length;
  })()`);
  if (clicked <= index) throw new Error(`Visible button not found: ${label} at index ${index}`);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label}: expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`);
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
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__kiranaQaErrors = [];
      window.addEventListener('error', (event) => window.__kiranaQaErrors.push(String(event.error?.stack || event.message || event.error)));
      window.addEventListener('unhandledrejection', (event) => window.__kiranaQaErrors.push(String(event.reason?.stack || event.reason)));
    ` });
    await navigate(client, `${FRONTEND_URL}/register`);

    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const mobile = `9${runId.slice(-9)}`;
    const setup = await client.evaluate(`(async () => {
      const apiUrl = ${JSON.stringify(API_URL)};
      const runId = ${JSON.stringify(runId)};
      const deviceId = localStorage.getItem('kiranaos_device_id') || localStorage.getItem('kirana-os:device-id:v1') || ('reports_ui_' + runId);
      const response = await fetch(apiUrl + '/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
        body: JSON.stringify({ shopName: 'Reports UI QA', ownerName: 'KiranaOS QA', city: 'Jodhpur', address: 'Visual QA', mobile: ${JSON.stringify(mobile)}, password: 'Test@12345', ownerPin: '2468' }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(json));
      const auth = json.data ?? json;
      localStorage.setItem('kiranaApiBaseUrl', apiUrl);
      localStorage.setItem('kiranaos_device_id', deviceId);
      localStorage.setItem('kirana-os:device-id:v1', deviceId);
      localStorage.setItem('kiranaos.auth.session.v1', JSON.stringify({ accessToken: auth.accessToken ?? auth.token, refreshToken: auth.refreshToken, user: auth.user, shop: auth.shop }));
      sessionStorage.setItem('kiranaos.security.sessionStarted.v1', String(Date.now()));
      await import('/src/features/core/demo/demo-shop-data.ts').then((module) => module.seedDemoShopData());
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

    const reportAudit = await client.evaluate(`(() => {
      const text = document.body.innerText;
      const periodButtons = [...document.querySelectorAll('button')].filter((button) => button.textContent?.trim() === 'This Week').length;
      const areaFills = [...document.querySelectorAll('.recharts-area-area')].map((path) => path.getAttribute('fill'));
      return {
        sales: text.includes('₹574'),
        profit: text.includes('₹88'),
        cash: text.includes('₹300'),
        upi: text.includes('₹154'),
        udhar: text.includes('₹120'),
        periodButtons,
        coloredAreaFills: areaFills.filter((fill) => fill && fill !== 'none' && fill !== 'transparent').length,
      };
    })()`);
    assertEqual(reportAudit.sales, true, "reports sales total");
    assertEqual(reportAudit.profit, true, "reports profit total");
    assertEqual(reportAudit.cash, true, "reports cash total");
    assertEqual(reportAudit.upi, true, "reports UPI total");
    assertEqual(reportAudit.udhar, true, "reports udhar total");
    if (reportAudit.periodButtons < 5) throw new Error(`Expected shared report period controls, found ${reportAudit.periodButtons}`);
    if (reportAudit.coloredAreaFills < 7) throw new Error(`Expected colored KPI area fills, found ${reportAudit.coloredAreaFills}`);

    await clickVisibleButton(client, "This Week");
    await waitForPage(client, `[...document.querySelectorAll('button')].some((button) => button.offsetParent !== null && button.textContent?.trim() === 'Today')`);
    await clickVisibleButton(client, "Today");
    await waitForPage(client, `[...document.querySelectorAll('button')].filter((button) => button.offsetParent !== null && button.textContent?.trim() === 'Today').length >= 5`);

    await clickVisibleButton(client, "Today");
    await waitForPage(client, `[...document.querySelectorAll('button')].some((button) => button.offsetParent !== null && button.textContent?.trim() === 'This Month')`);
    await clickVisibleButton(client, "This Month");
    await waitForPage(client, `[...document.querySelectorAll('button')].filter((button) => button.offsetParent !== null && button.textContent?.trim() === 'This Month').length >= 5`);

    const desktop = await screenshot(client, path.resolve("reports-desktop.png"), 1680, 980);
    const mobileMetrics = await screenshot(client, path.resolve("reports-mobile.png"), 390, 844);

    await client.send("Emulation.setDeviceMetricsOverride", { width: 1680, height: 980, deviceScaleFactor: 1, mobile: false });
    await navigate(client, `${FRONTEND_URL}/dashboard`);
    await waitForPage(client, "document.body.innerText.includes('Sales Overview') && document.body.innerText.includes('Payment Mode Breakdown')");
    await sleep(1_000);
    const dashboardAudit = await client.evaluate(`(() => {
      const text = document.body.innerText;
      return {
        sales: text.includes('₹574'),
        profit: text.includes('₹88'),
        cash: text.includes('₹300'),
        upi: text.includes('₹154'),
        udhar: text.includes('₹120'),
        weekControls: [...document.querySelectorAll('button')].filter((button) => button.offsetParent !== null && button.textContent?.trim() === 'This Week').length,
      };
    })()`);
    assertEqual(dashboardAudit.sales, true, "dashboard sales total");
    assertEqual(dashboardAudit.profit, true, "dashboard profit total");
    assertEqual(dashboardAudit.cash, true, "dashboard cash breakdown");
    assertEqual(dashboardAudit.upi, true, "dashboard UPI breakdown");
    assertEqual(dashboardAudit.udhar, true, "dashboard udhar breakdown");
    if (dashboardAudit.weekControls < 2) throw new Error(`Expected synchronized dashboard period controls, found ${dashboardAudit.weekControls}`);

    await clickVisibleButton(client, "This Week");
    await waitForPage(client, `[...document.querySelectorAll('button')].some((button) => button.offsetParent !== null && button.textContent?.trim() === 'Today')`);
    await clickVisibleButton(client, "Today");
    await waitForPage(client, `[...document.querySelectorAll('button')].filter((button) => button.offsetParent !== null && button.textContent?.trim() === 'Today').length >= 2`);
    await clickVisibleButton(client, "Today");
    await waitForPage(client, `[...document.querySelectorAll('button')].some((button) => button.offsetParent !== null && button.textContent?.trim() === 'This Week')`);
    await clickVisibleButton(client, "This Week");
    await waitForPage(client, `[...document.querySelectorAll('button')].filter((button) => button.offsetParent !== null && button.textContent?.trim() === 'This Week').length >= 2`);

    const dashboardDesktop = await screenshot(client, path.resolve("dashboard-desktop.png"), 1680, 980);
    const dashboardMobile = await screenshot(client, path.resolve("dashboard-mobile.png"), 390, 844);
    const runtimeErrors = await client.evaluate("window.__kiranaQaErrors || []");
    if (runtimeErrors.length > 0) throw new Error(`Browser runtime errors: ${runtimeErrors.join(' | ')}`);
    console.log(JSON.stringify({ setup, reportAudit, dashboardAudit, desktop, mobile: mobileMetrics, dashboardDesktop, dashboardMobile, runtimeErrors }, null, 2));
  } finally {
    client?.close();
    chrome.kill();
  }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
