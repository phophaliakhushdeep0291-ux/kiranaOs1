import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.QA_FRONTEND_URL || "http://127.0.0.1:5173";
const API_URL = process.env.QA_API_URL || "http://127.0.0.1:3000/api";
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.QA_DEBUG_PORT || 9482);
const OUTPUT_DIR = path.resolve(process.env.QA_OUTPUT_DIR || "qa-artifacts/mobile-core-matrix");
const VIEWPORTS = [[375, 667], [390, 844], [430, 932], [768, 1024]];
const ROUTES = [
  ["MQA-BILL-01", "/billing"], ["MQA-PROD-01", "/products"],
  ["MQA-CUST-01", "/customers"], ["MQA-INV-01", "/inventory"],
  ["MQA-PUR-01", "/purchase-bills"], ["MQA-RPT-01", "/reports"],
  ["MQA-SET-01", "/settings"], ["MQA-SYNC-01", "/sync-status"],
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

class CdpClient {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)), pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket?.close(); }
}

async function waitFor(url, timeout = 25_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* runtime starting */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPage(client, expression, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await client.evaluate(expression)) return; await sleep(150); }
  const state = await client.evaluate(`({href:location.href,text:document.body?.innerText?.slice(0,1200),errors:window.__arthaQaErrors||[]})`).catch(() => null);
  throw new Error(`Page condition timed out: ${expression}; ${JSON.stringify(state)}`);
}

async function navigate(client, route) {
  await client.send("Page.navigate", { url: `${FRONTEND_URL}${route}` });
  await waitForPage(client, `document.readyState === "complete" && location.pathname === ${JSON.stringify(route)}`);
  await waitForPage(client, `document.body && document.body.innerText.trim().length > 30`);
  await sleep(900);
}

async function registerSession(client) {
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`, mobile = `8${runId.slice(-9)}`;
  await client.evaluate(`(async()=>{const apiUrl=${JSON.stringify(API_URL)},deviceId=localStorage.getItem("kiranaos_device_id")||localStorage.getItem("kirana-os:device-id:v1");if(!deviceId)throw new Error("Browser device identity was not initialized");const response=await fetch(apiUrl+"/auth/register",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({shopName:"Mobile Matrix QA",ownerName:"QA Owner",city:"Jaipur",address:"Automated QA",mobile:${JSON.stringify(mobile)},password:"Test@12345",ownerPin:"2468"})});const json=await response.json();if(!response.ok)throw new Error("Registration failed: "+JSON.stringify(json));const auth=json.data??json;localStorage.setItem("kiranaApiBaseUrl",apiUrl);localStorage.setItem("kiranaos.auth.session.v1",JSON.stringify({accessToken:auth.accessToken??auth.token,refreshToken:auth.refreshToken,user:auth.user,shop:auth.shop}));sessionStorage.setItem("kiranaos.security.sessionStarted.v1",String(Date.now()));return true})()`);
}

async function auditPage(client, qaId, route, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await navigate(client, route);
  const metrics = await client.evaluate(`(()=>{const visible=node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity||1)>0&&rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight};const controls=[...document.querySelectorAll("button,input,select,textarea,[role=button],[role=combobox],a[href]")].filter(visible).map(node=>{const rect=node.getBoundingClientRect();return{tag:node.tagName,type:node.getAttribute("type")||"",label:(node.getAttribute("aria-label")||node.textContent||node.getAttribute("placeholder")||"").trim().replace(/\\s+/g," ").slice(0,70),width:Math.round(rect.width),height:Math.round(rect.height)}}).filter(control=>!(["checkbox","radio","hidden"].includes(control.type))&&!(control.tag==="SELECT"&&control.width<=2&&control.height<=2));const undersized=controls.filter(control=>control.width<44||control.height<44),text=document.body.innerText;return{path:location.pathname,viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,undersized:undersized.slice(0,30),undersizedCount:undersized.length,visibleControlCount:controls.length,desktopSidebarVisible:[...document.querySelectorAll(".app-desktop-sidebar")].some(visible),genericFailure:/something went wrong|unexpected error|page failed to load/i.test(text),stuckLoading:/loading(?:\\.{3}|…)?$/im.test(text.trim()),runtimeErrors:window.__arthaQaErrors||[]}})()`);
  const image = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const filename = `${qaId.toLowerCase()}-${width}x${height}.png`;
  await writeFile(path.join(OUTPUT_DIR, filename), Buffer.from(image.data, "base64"));
  assert(metrics.path === route, `${qaId} redirected from ${route} to ${metrics.path}`);
  assert(metrics.documentWidth <= width + 1 && metrics.bodyWidth <= width + 1, `${qaId} ${width}px horizontal overflow: ${JSON.stringify(metrics)}`);
  assert(!metrics.desktopSidebarVisible, `${qaId} ${width}px shows desktop sidebar`);
  assert(!metrics.genericFailure, `${qaId} ${width}px rendered an error boundary`);
  assert(!metrics.stuckLoading, `${qaId} ${width}px remained in a loading state`);
  assert(metrics.runtimeErrors.length === 0, `${qaId} ${width}px runtime errors: ${metrics.runtimeErrors.join(" | ")}`);
  return { qaId, route, width, height, ...metrics, screenshot: filename };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await waitFor(`${API_URL.replace(/\/api$/, "")}/health/ready`); await waitFor(FRONTEND_URL);
  const profile = await mkdtemp(path.join(tmpdir(), "artha-mobile-matrix-"));
  const chrome = spawn(CHROME_PATH, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, `${FRONTEND_URL}/register`], { windowsHide: true, stdio: "ignore" });
  let client;
  try {
    await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(), target = targets.find((item) => item.type === "page" && item.url.startsWith(FRONTEND_URL));
    assert(target, "Chrome did not create the application page");
    client = new CdpClient(target.webSocketDebuggerUrl); await client.connect(); await client.send("Page.enable"); await client.send("Runtime.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__arthaQaErrors=[];window.addEventListener("error",event=>window.__arthaQaErrors.push(String(event.error?.stack||event.message||event.error)));window.addEventListener("unhandledrejection",event=>window.__arthaQaErrors.push(String(event.reason?.stack||event.reason)));` });
    await navigate(client, "/register"); await registerSession(client);
    const results = [];
    for (const [qaId, route] of ROUTES) for (const [width, height] of VIEWPORTS) results.push(await auditPage(client, qaId, route, width, height));
    await writeFile(path.join(OUTPUT_DIR, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), frontendUrl: FRONTEND_URL, apiUrl: API_URL, results }, null, 2));
    const undersized = results.filter((result) => result.undersizedCount > 0);
    assert(undersized.length === 0, `${undersized.length}/${results.length} captures contain controls below 44x44; inspect ${path.join(OUTPUT_DIR, "report.json")}`);
    console.log(`Mobile core matrix passed ${results.length}/${results.length} captures. Artifacts: ${OUTPUT_DIR}`);
  } finally { client?.close(); chrome.kill(); }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
