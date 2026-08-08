import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.QA_OFFLINE_FRONTEND_URL || "http://localhost:51977";
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin;
const API_URL = process.env.QA_API_URL || "http://127.0.0.1:3000/api";
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.QA_OFFLINE_DEBUG_PORT || 9484);
const OUTPUT_DIR = path.resolve(process.env.QA_OFFLINE_OUTPUT_DIR || "qa-artifacts/offline-core-restart");
const PROFILE_DIR = path.resolve(process.env.QA_OFFLINE_PROFILE_DIR || path.join(tmpdir(), "artha-offline-core-restart-profile"));
const BUILD_ID = process.env.QA_OFFLINE_BUILD_ID || "offline-core-restart-qa";
const VIEWPORT = { width: 390, height: 844 };
const ROUTES = [
  ["OQA-DASH-01", "/dashboard"],
  ["OQA-BILL-01", "/billing"],
  ["OQA-PROD-01", "/products"],
  ["OQA-CUST-01", "/customers"],
  ["OQA-INV-01", "/inventory"],
  ["OQA-HIST-01", "/bills"],
  ["OQA-PUR-01", "/purchase-bills"],
  ["OQA-RPT-01", "/reports"],
  ["OQA-SET-01", "/settings"],
  ["OQA-SYNC-01", "/sync-status"],
];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

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

async function waitForUrl(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* process is starting */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPage(client, expression, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await client.evaluate(expression)) return; } catch { /* navigation swaps execution contexts */ }
    await sleep(150);
  }
  const state = await client.evaluate(`({href:location.href,text:document.body?.innerText?.slice(0,1500),errors:window.__arthaQaErrors||[]})`).catch(() => null);
  throw new Error(`Page condition timed out: ${expression}; ${JSON.stringify(state)}`);
}

async function waitForExit(child, timeout = 5_000) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(timeout),
  ]);
}

async function runBuild() {
  const child = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js", "build", "--configLoader", "runner", "--config", "vite.config.ts",
  ], {
    cwd: path.resolve("."),
    env: { ...process.env, VITE_API_BASE_URL: API_URL, KIRANA_BUILD_ID: BUILD_ID },
    windowsHide: true,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert(exitCode === 0, `Production build failed with exit code ${exitCode}`);
}

async function startPreview() {
  const preview = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js", "preview", "--config", "vite.config.ts",
    "--host", "127.0.0.1", "--port", String(new URL(FRONTEND_URL).port || 4173), "--strictPort",
  ], { cwd: path.resolve("."), windowsHide: true, stdio: "ignore" });
  await waitForUrl(FRONTEND_URL);
  return preview;
}

async function launchChrome(initialUrl) {
  const chrome = spawn(CHROME_PATH, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE_DIR}`, initialUrl,
  ], { windowsHide: true, stdio: "ignore" });
  await waitForUrl(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const target = targets.find((item) => item.type === "page");
  assert(target, "Chrome did not create a page target");
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__arthaQaErrors=[];window.addEventListener("error",event=>window.__arthaQaErrors.push(String(event.error?.stack||event.message||event.error)));window.addEventListener("unhandledrejection",event=>window.__arthaQaErrors.push(String(event.reason?.stack||event.reason)));`,
  });
  return { chrome, client };
}

async function closeChrome(client, chrome) {
  if (client) {
    await client.send("Browser.close").catch(() => {});
    client.close();
  }
  await waitForExit(chrome);
  if (chrome.exitCode === null) chrome.kill();
}

async function prepareAppOrigin(client) {
  await client.send("Page.navigate", { url: `${FRONTEND_URL}/manifest.webmanifest` });
  await waitForPage(client, `document.readyState === "complete" && location.origin === ${JSON.stringify(FRONTEND_ORIGIN)}`);
}

async function ensureSession(client) {
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const outcome = await client.evaluate(`(async()=>{
    const apiUrl=${JSON.stringify(API_URL)},sessionKey="kiranaos.auth.session.v1",mobileKey="kiranaos.qa.offline.mobile",password="Test@12345";
    let deviceId=localStorage.getItem("kiranaos_device_id")||localStorage.getItem("kirana-os:device-id:v1");
    if(!deviceId){deviceId="offline_restart_"+crypto.randomUUID();localStorage.setItem("kiranaos_device_id",deviceId);localStorage.setItem("kirana-os:device-id:v1",deviceId)}
    let stored={};try{stored=JSON.parse(localStorage.getItem(sessionKey)||"{}")||{}}catch{}
    const headers=(token)=>({authorization:"Bearer "+token,"x-device-id":deviceId});
    const save=(auth)=>{const session={accessToken:auth.accessToken??auth.token,refreshToken:auth.refreshToken,user:auth.user,shop:auth.shop};localStorage.setItem(sessionKey,JSON.stringify(session));return session};
    const verify=async(session)=>session?.accessToken&&Boolean((await fetch(apiUrl+"/auth/me",{headers:headers(session.accessToken)})).ok);
    if(await verify(stored))return "reused";
    if(stored.refreshToken){const response=await fetch(apiUrl+"/auth/refresh",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({refreshToken:stored.refreshToken})});if(response.ok){const json=await response.json(),session=save(json.data??json);if(await verify(session))return "refreshed"}}
    const knownMobile=localStorage.getItem(mobileKey)||stored.user?.mobile||stored.user?.phone||"";
    if(knownMobile){const response=await fetch(apiUrl+"/auth/login",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({mobile:knownMobile,password})}),json=await response.json();if(!response.ok)throw new Error("QA login failed: "+JSON.stringify(json));save(json.data??json);localStorage.setItem(mobileKey,knownMobile);return "logged-in"}
    const qaMobile="7"+${JSON.stringify(runId)}.slice(-9),response=await fetch(apiUrl+"/auth/register",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({shopName:"Offline Restart QA",ownerName:"QA Owner",city:"Jaipur",address:"Automated offline QA",mobile:qaMobile,password,ownerPin:"2468"})}),json=await response.json();if(!response.ok)throw new Error("Registration failed: "+JSON.stringify(json));save(json.data??json);localStorage.setItem(mobileKey,qaMobile);return "registered"
  })()`);
  console.log(`Offline QA auth session: ${outcome}`);
}

async function seedCoreData(client) {
  return client.evaluate(`(async()=>{
    const apiUrl=${JSON.stringify(API_URL)},session=JSON.parse(localStorage.getItem("kiranaos.auth.session.v1")||"{}"),deviceId=localStorage.getItem("kiranaos_device_id"),headers={"content-type":"application/json",authorization:"Bearer "+session.accessToken,"x-device-id":deviceId,"x-owner-pin":"2468"};
    const request=async(path,options={})=>{const response=await fetch(apiUrl+path,{...options,headers:{...headers,...(options.headers||{})}}),json=await response.json();if(!response.ok)throw new Error(path+": "+JSON.stringify(json));return json.data??json};
    const products=await request("/products");
    if(!products.some(product=>product.name==="Offline Matrix Rice"))await request("/products",{method:"POST",body:JSON.stringify({name:"Offline Matrix Rice",category:"Grocery",displayUnit:"kg",baseUnit:"kg",rateUnit:"kg",stockBaseQty:25,costPerRateUnit:42,minPricePerRateUnit:45,defaultPricePerRateUnit:50,mrp:55,gstRate:5})});
    const customers=await request("/customers");
    if(!customers.some(customer=>customer.name==="Offline Matrix Customer"))await request("/customers",{method:"POST",body:JSON.stringify({name:"Offline Matrix Customer",mobile:"9876504321",type:"regular"})});
    return true
  })()`);
}

async function navigateOnline(client, route) {
  await client.send("Page.navigate", { url: `${FRONTEND_URL}${route}` });
  await waitForPage(client, `document.readyState === "complete" && location.pathname === ${JSON.stringify(route)}`);
  await waitForPage(client, `document.body && document.body.innerText.trim().length > 30`);
  await sleep(800);
}

async function primeOfflineInstall(client) {
  await prepareAppOrigin(client);
  await ensureSession(client);
  await seedCoreData(client);
  await navigateOnline(client, "/dashboard");
  await waitForPage(client, `navigator.serviceWorker && navigator.serviceWorker.ready.then(()=>true)`);
  await waitForPage(client, `navigator.serviceWorker.controller !== null`);
  for (const [, route] of ROUTES) await navigateOnline(client, route);
  await navigateOnline(client, "/products");
  await waitForPage(client, `document.body.innerText.includes("Offline Matrix Rice")`, 60_000);
  await navigateOnline(client, "/customers");
  await waitForPage(client, `document.body.innerText.includes("Offline Matrix Customer")`, 60_000);
  const cacheState = await client.evaluate(`(async()=>{const keys=(await caches.keys()).filter(key=>key.startsWith("kiranaos-shell"));const entries=[];for(const key of keys){const cache=await caches.open(key);entries.push(...(await cache.keys()).map(request=>new URL(request.url).pathname))}return{keys,entryCount:new Set(entries).size,hasIndex:entries.includes("/index.html"),hasManifest:entries.includes("/manifest.webmanifest"),hasOffline:entries.includes("/offline.html"),hasScript:entries.some(path=>path.endsWith(".js")),hasStyles:entries.some(path=>path.endsWith(".css"))}})()`);
  assert(cacheState.keys.length > 0 && cacheState.hasIndex && cacheState.hasManifest && cacheState.hasOffline && cacheState.hasScript && cacheState.hasStyles, `Offline shell did not finish caching: ${JSON.stringify(cacheState)}`);
  return cacheState;
}

async function setOffline(client) {
  await client.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: "none",
  });
  await sleep(500);
}

async function auditOfflineRoute(client, qaId, route) {
  await client.send("Page.navigate", { url: `${FRONTEND_URL}${route}` });
  await waitForPage(client, `document.readyState === "complete" && location.pathname === ${JSON.stringify(route)}`, 60_000);
  await waitForPage(client, `document.body && document.body.innerText.trim().length > 30`, 60_000);
  await sleep(1_200);
  const metrics = await client.evaluate(`(()=>{const text=document.body.innerText;return{path:location.pathname,online:navigator.onLine,controlled:Boolean(navigator.serviceWorker?.controller),documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,genericFailure:/something went wrong|unexpected error|page failed to load|application failed to start/i.test(text),stuckLoading:/loading(?:\\.{3}|…)?$/im.test(text.trim()),runtimeErrors:window.__arthaQaErrors||[],hasSeedProduct:text.includes("Offline Matrix Rice"),hasSeedCustomer:text.includes("Offline Matrix Customer")}})()`);
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const filename = `${qaId.toLowerCase()}-${VIEWPORT.width}x${VIEWPORT.height}.png`;
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, filename), Buffer.from(screenshot.data, "base64"));
  assert(metrics.path === route, `${qaId} bounced from ${route} to ${metrics.path}`);
  assert(metrics.online === false, `${qaId} was not tested with browser networking disabled`);
  assert(metrics.controlled, `${qaId} was not served under the installed service worker`);
  assert(metrics.documentWidth <= VIEWPORT.width + 1 && metrics.bodyWidth <= VIEWPORT.width + 1, `${qaId} overflowed offline: ${JSON.stringify(metrics)}`);
  assert(!metrics.genericFailure, `${qaId} rendered a fatal offline error`);
  assert(!metrics.stuckLoading, `${qaId} remained stuck loading offline`);
  assert(metrics.runtimeErrors.length === 0, `${qaId} runtime errors offline: ${metrics.runtimeErrors.join(" | ")}`);
  if (route === "/products") assert(metrics.hasSeedProduct, `${qaId} did not restore cached product data`);
  if (route === "/customers") assert(metrics.hasSeedCustomer, `${qaId} did not restore cached customer data`);
  return { qaId, route, ...metrics, screenshot: filename };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(PROFILE_DIR, { recursive: true });
  await waitForUrl(`${API_URL.replace(/\/api$/, "")}/health/ready`);
  if (process.env.QA_OFFLINE_SKIP_BUILD !== "true") await runBuild();
  const preview = await startPreview();
  let onlineBrowser;
  let offlineBrowser;
  try {
    onlineBrowser = await launchChrome("about:blank");
    const cacheState = await primeOfflineInstall(onlineBrowser.client);
    await closeChrome(onlineBrowser.client, onlineBrowser.chrome);
    onlineBrowser = null;

    offlineBrowser = await launchChrome("about:blank");
    await offlineBrowser.client.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: true });
    await setOffline(offlineBrowser.client);
    const results = [];
    for (const [qaId, route] of ROUTES) results.push(await auditOfflineRoute(offlineBrowser.client, qaId, route));
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path.join(OUTPUT_DIR, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), buildId: BUILD_ID, frontendUrl: FRONTEND_URL, cacheState, coldRestart: true, networkDisabled: true, results }, null, 2));
    console.log(`Offline cold-restart matrix passed ${results.length}/${results.length} routes. Artifacts: ${OUTPUT_DIR}`);
  } finally {
    if (onlineBrowser) await closeChrome(onlineBrowser.client, onlineBrowser.chrome);
    if (offlineBrowser) await closeChrome(offlineBrowser.client, offlineBrowser.chrome);
    if (preview.exitCode === null) preview.kill();
    await waitForExit(preview);
  }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
