import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.QA_FRONTEND_URL || "http://localhost:5173";
const API_URL = process.env.QA_API_URL || "http://localhost:3000/api";
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.QA_DEBUG_PORT || 9453);
const OUTPUT_DIR = path.resolve(process.env.QA_OUTPUT_DIR || ".");
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

async function waitForHttp(url, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* starting */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPage(client, expression, timeout = 20_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await client.evaluate(`Boolean(${expression})`)) return;
    await sleep(150);
  }
  throw new Error(`Timed out waiting for page condition: ${expression}`);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  await waitForPage(client, "document.readyState === 'complete'");
}

async function screenshot(client, name) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  const result = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const target = path.join(OUTPUT_DIR, name);
  await writeFile(target, Buffer.from(result.data, "base64"));
  return target;
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), "artha-purchase-receive-"));
  const chrome = spawn(CHROME_PATH, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, `${FRONTEND_URL}/register`,
  ], { windowsHide: true, stdio: "ignore" });
  let client;
  try {
    await waitForHttp(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    const target = targets.find((item) => item.type === "page" && item.url.startsWith(FRONTEND_URL));
    assert(target, "Purchase receive browser target was not created");
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.connect();
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__arthaQaErrors=[];addEventListener('error',e=>window.__arthaQaErrors.push(String(e.error?.stack||e.message)));addEventListener('unhandledrejection',e=>window.__arthaQaErrors.push(String(e.reason)));` });
    await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await navigate(client, `${FRONTEND_URL}/register`);

    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const seeded = await client.evaluate(`(async()=>{
      const api=${JSON.stringify(API_URL)},deviceId='purchase_receive_${runId}';
      const request=async(path,options={})=>{const response=await fetch(api+path,options);const json=await response.json();if(!response.ok)throw new Error(path+': '+JSON.stringify(json));return json.data??json};
      const auth=await request('/auth/register',{method:'POST',headers:{'content-type':'application/json','x-device-id':deviceId},body:JSON.stringify({shopName:'Purchase Receive QA',ownerName:'Artha QA',city:'Pune',mobile:'9${runId.slice(-9)}',password:'Test@12345',ownerPin:'2468'})});
      const headers={'content-type':'application/json',authorization:'Bearer '+(auth.accessToken??auth.token),'x-device-id':deviceId,'x-owner-pin':'2468'};
      localStorage.setItem('kiranaApiBaseUrl',api);localStorage.setItem('kiranaos_device_id',deviceId);localStorage.setItem('kirana-os:device-id:v1',deviceId);localStorage.setItem('kiranaos.auth.session.v1',JSON.stringify({accessToken:auth.accessToken??auth.token,refreshToken:auth.refreshToken,user:auth.user,shop:auth.shop}));
      const product=await request('/products',{method:'POST',headers,body:JSON.stringify({name:'QA Receiving Oil',category:'Grocery',displayUnit:'piece',baseUnit:'piece',rateUnit:'piece',stockBaseQty:24,costPerRateUnit:232,minPricePerRateUnit:250,defaultPricePerRateUnit:265,mrp:280,gstRate:5,lowStockThreshold:8})});
      const supplier=await request('/suppliers',{method:'POST',headers,body:JSON.stringify({name:'QA Reliable Wholesale',mobile:'9876543210'})});
      const order=await request('/purchase-orders',{method:'POST',headers,body:JSON.stringify({supplierId:supplier.id,supplierName:supplier.name,paymentTerms:'Net 7 days',items:[{productId:product.id,orderedBaseQty:4,expectedRate:230}]})});
      await request('/purchase-orders/'+order.id+'/send',{method:'POST',headers,body:'{}'});
      return {productId:product.id,orderId:order.id,accessToken:auth.accessToken??auth.token,deviceId};
    })()`);

    await navigate(client, `${FRONTEND_URL}/purchase-bills`);
    await waitForPage(client, "document.body.innerText.includes('QA Reliable Wholesale')");
    await client.evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent?.trim()==='Receive');if(!button)throw new Error('Receive action missing');button.click();return true})()`);
    await waitForPage(client, "document.querySelector('[data-mobile-task-dialog=\"true\"]')");
    await sleep(350);
    const formAudit = await client.evaluate(`(()=>{
      const dialog=document.querySelector('[data-mobile-task-dialog="true"]');
      const set=(node,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));node.dispatchEvent(new Event('change',{bubbles:true}))};
      const inputs=[...dialog.querySelectorAll('input')],numbers=inputs.filter(node=>node.type==='number'),invoice=inputs.find(node=>node.type==='text');
      if(!invoice||numbers.length<3)throw new Error('Receive fields missing');set(invoice,'QA-SUP-1001');set(numbers[0],'100');
      const rect=dialog.getBoundingClientRect(),controls=[...dialog.querySelectorAll('input,textarea,button,[role="combobox"]')].filter(node=>getComputedStyle(node).display!=='none');
      return {rect:[Math.round(rect.left),Math.round(rect.top),Math.round(rect.width),Math.round(rect.height)],minControlHeight:Math.min(...controls.map(node=>node.getBoundingClientRect().height)),overflowX:dialog.scrollWidth-dialog.clientWidth,totalVisible:dialog.textContent.includes('₹920')};
    })()`);
    assert(JSON.stringify(formAudit.rect) === JSON.stringify([0, 0, 390, 844]), `Receive task is not full-screen: ${JSON.stringify(formAudit)}`);
    assert(formAudit.minControlHeight >= 43 && formAudit.overflowX <= 2 && formAudit.totalVisible, `Receive task mobile contract failed: ${JSON.stringify(formAudit)}`);
    const artifact = await screenshot(client, "purchase-receive-task-390.png");

    await client.evaluate(`(()=>{const button=[...document.querySelectorAll('[data-mobile-task-dialog="true"] button')].find(node=>node.textContent?.includes('Review receipt'));if(!button)throw new Error('Review receipt missing');button.click();return true})()`);
    await waitForPage(client, "[...document.querySelectorAll('form')].some(form=>form.textContent?.includes('Owner PIN'))");
    await client.evaluate(`(()=>{const form=[...document.querySelectorAll('form')].find(node=>node.textContent?.includes('Owner PIN')),pin=form?.querySelector('input[type="password"]');if(!pin)throw new Error('Owner PIN field missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(pin,'2468');pin.dispatchEvent(new Event('input',{bubbles:true}));pin.dispatchEvent(new Event('change',{bubbles:true}));form.requestSubmit();return true})()`);
    await waitForPage(client, "![...document.querySelectorAll('form')].some(form=>form.textContent?.includes('Owner PIN'))", 30_000);
    await sleep(500);

    const headers = { authorization: `Bearer ${seeded.accessToken}`, "x-device-id": seeded.deviceId };
    const [ordersResponse, productsResponse] = await Promise.all([
      fetch(`${API_URL}/purchase-orders?status=all&limit=50`, { headers }),
      fetch(`${API_URL}/products?limit=1000`, { headers }),
    ]);
    assert(ordersResponse.ok && productsResponse.ok, "Receive verification API request failed");
    const ordersJson = await ordersResponse.json(), productsJson = await productsResponse.json();
    const order = (ordersJson.data ?? ordersJson).find((row) => row.id === seeded.orderId);
    const product = (productsJson.data ?? productsJson).find((row) => row.id === seeded.productId);
    const receipt = order?.receipts?.[0];
    const result = { orderStatus: order?.status, stockBaseQty: product?.stockBaseQty, receiptTotal: receipt?.totalAmount, paidAmount: receipt?.paidAmount, dueAmount: receipt?.dueAmount, supplierInvoiceNumber: receipt?.supplierInvoiceNumber, runtimeErrors: await client.evaluate("window.__arthaQaErrors||[]"), artifact };
    assert(result.orderStatus === "received" && result.stockBaseQty === 28, `Stock/order reconciliation failed: ${JSON.stringify(result)}`);
    assert(result.receiptTotal === 920 && result.paidAmount === 100 && result.dueAmount === 820 && result.supplierInvoiceNumber === "QA-SUP-1001", `Supplier payment reconciliation failed: ${JSON.stringify(result)}`);
    assert(result.runtimeErrors.length === 0, `Runtime errors: ${result.runtimeErrors.join(" | ")}`);
    console.log(JSON.stringify({ formAudit, result }, null, 2));
  } finally {
    client?.close();
    chrome.kill();
  }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
