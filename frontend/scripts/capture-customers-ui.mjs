import { spawn } from "node:child_process";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.QA_FRONTEND_URL || "http://localhost:5173";
const API_URL = process.env.QA_API_URL || "http://localhost:3000/api";
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.QA_DEBUG_PORT || 9446);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class CdpClient {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)); const pending = this.pending.get(message.id);
      if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); }); }
  async evaluate(expression) { const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value; }
  close() { this.socket?.close(); }
}

async function waitFor(url, timeout = 20_000) { const end = Date.now() + timeout; while (Date.now() < end) { try { const response = await fetch(url); if (response.ok) return; } catch { /* starting */ } await sleep(150); } throw new Error(`Timed out waiting for ${url}`); }
async function waitForPage(client, expression, timeout = 25_000) { const end = Date.now() + timeout; while (Date.now() < end) { if (await client.evaluate(expression)) return; await sleep(150); } const diagnostic=await client.evaluate(`({url:location.href,text:document.body?.innerText?.slice(0,1400),errors:window.__kiranaQaErrors||[]})`).catch(()=>null); throw new Error(`Timed out waiting for ${expression}; page=${JSON.stringify(diagnostic)}`); }
async function navigate(client, url) { await client.send("Page.navigate", { url }); await waitForPage(client, "document.readyState === 'complete'"); }
function assert(value, message) { if (!value) throw new Error(message); }

async function capture(client, file, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 }); await sleep(700);
  const metrics = await client.evaluate(`(() => ({ viewport: [innerWidth, innerHeight], documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth, cards: document.querySelectorAll('article').length }))()`);
  assert(metrics.documentWidth <= width && metrics.bodyWidth <= width, `${file} page overflow: ${JSON.stringify(metrics)}`);
  const image = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(path.resolve(file), Buffer.from(image.data, "base64")); return metrics;
}

async function main() {
  const profile = await mkdtemp(path.join(tmpdir(), "kirana-customers-ui-"));
  const chrome = spawn(CHROME_PATH, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`, `${FRONTEND_URL}/register`], { windowsHide: true, stdio: "ignore" });
  let client;
  try {
    await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(); const target = targets.find((item) => item.type === "page" && item.url.startsWith(FRONTEND_URL));
    if (!target) throw new Error("Customer-page browser target was not created");
    client = new CdpClient(target.webSocketDebuggerUrl); await client.connect(); await client.send("Page.enable"); await client.send("Runtime.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__kiranaQaErrors=[];window.addEventListener('error',e=>window.__kiranaQaErrors.push(String(e.error?.stack||e.message||e.error)));window.addEventListener('unhandledrejection',e=>window.__kiranaQaErrors.push(String(e.reason?.stack||e.reason)));` });
    await navigate(client, `${FRONTEND_URL}/register`);
    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`; const mobile = `9${runId.slice(-9)}`;
    await client.evaluate(`(async () => {
      const apiUrl=${JSON.stringify(API_URL)}, runId=${JSON.stringify(runId)};
      const deviceId=localStorage.getItem('kiranaos_device_id')||localStorage.getItem('kirana-os:device-id:v1')||('customers_ui_'+runId);
      const response=await fetch(apiUrl+'/auth/register',{method:'POST',headers:{'content-type':'application/json','x-device-id':deviceId},body:JSON.stringify({shopName:'Customers UI QA',ownerName:'KiranaOS QA',city:'Jodhpur',address:'Visual QA',mobile:${JSON.stringify(mobile)},password:'Test@12345',ownerPin:'2468'})});
      const json=await response.json(); if(!response.ok) throw new Error(JSON.stringify(json)); const auth=json.data??json;
      localStorage.setItem('kiranaApiBaseUrl',apiUrl);localStorage.setItem('kiranaos_device_id',deviceId);localStorage.setItem('kirana-os:device-id:v1',deviceId);localStorage.setItem('kiranaos.auth.session.v1',JSON.stringify({accessToken:auth.accessToken??auth.token,refreshToken:auth.refreshToken,user:auth.user,shop:auth.shop}));
      for (const customer of [
        {name:'Ramesh Sharma',mobile:'9988776655',address:'MG Road, Jaipur',type:'udhar',udharAmount:30000},
        {name:'Suresh Kumar',mobile:'9876543210',address:'Vaishali Nagar, Jaipur',type:'udhar',udharAmount:22800},
        {name:'Pooja Meena',mobile:'9001234567',address:'Mansarovar, Jaipur',type:'udhar',udharAmount:7560},
        {name:'Vikram Singh',mobile:'8899001122',address:'Malviya Nagar, Jaipur',type:'regular',udharAmount:0},
      ]) {
        const created=await fetch(apiUrl+'/customers',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+(auth.accessToken??auth.token),'x-device-id':deviceId},body:JSON.stringify(customer)});
        if(!created.ok) throw new Error('Customer seed failed: '+await created.text());
      }
      const {offlineDB}=await import('/src/lib/offline/db.ts'); const now=new Date(); const iso=(days,hour)=>{const value=new Date(now);value.setDate(value.getDate()-days);value.setHours(hour,15,0,0);return value.toISOString();};
      await offlineDB.putMany('customers',[
        {id:'qa_customer_ramesh',name:'Ramesh Sharma',mobile:'9988776655',address:'MG Road, Jaipur',type:'udhar',udharLimit:50000,notes:'Usually pays after 15-20 days.',createdAt:iso(180,10),sync_status:'synced'},
        {id:'qa_customer_suresh',name:'Suresh Kumar',mobile:'9876543210',address:'Vaishali Nagar, Jaipur',type:'udhar',udharLimit:40000,createdAt:iso(120,10),sync_status:'synced'},
        {id:'qa_customer_pooja',name:'Pooja Meena',mobile:'9001234567',address:'Mansarovar, Jaipur',type:'udhar',udharLimit:25000,createdAt:iso(90,10),sync_status:'synced'},
        {id:'qa_customer_vikram',name:'Vikram Singh',mobile:'8899001122',address:'Malviya Nagar, Jaipur',type:'regular',createdAt:iso(60,10),sync_status:'synced'},
      ]);
      await offlineDB.putMany('customer_ledger',[
        {id:'qa_ledger_r_bill',customerId:'qa_customer_ramesh',type:'BILL',amount:30000,source_type:'bill',source_id:'INV-01562',note:'Groceries billed',entry_at:iso(40,10),sync_status:'synced'},
        {id:'qa_ledger_r_pay1',customerId:'qa_customer_ramesh',type:'PAYMENT',amount:5000,source_type:'payment',source_id:'PAY-0098',note:'Payment received',entry_at:iso(2,11),sync_status:'synced'},
        {id:'qa_ledger_r_pay2',customerId:'qa_customer_ramesh',type:'PAYMENT',amount:150,source_type:'payment',source_id:'PAY-0099',note:'UPI payment',entry_at:iso(0,12),sync_status:'synced'},
        {id:'qa_ledger_s_bill',customerId:'qa_customer_suresh',type:'BILL',amount:22800,source_type:'bill',source_id:'INV-01558',note:'Household items billed',entry_at:iso(12,9),sync_status:'synced'},
        {id:'qa_ledger_p_bill',customerId:'qa_customer_pooja',type:'BILL',amount:7560,source_type:'bill',source_id:'INV-01550',note:'Grocery billed',entry_at:iso(4,15),sync_status:'synced'},
      ]);
      await offlineDB.putMany('payments',[
        {id:'qa_payment_1',customerId:'qa_customer_ramesh',amount:5000,mode:'cash',paidAt:iso(2,11),createdAt:iso(2,11),sync_status:'synced'},
        {id:'qa_payment_2',customerId:'qa_customer_ramesh',amount:150,mode:'upi',paidAt:iso(0,12),createdAt:iso(0,12),sync_status:'synced'},
      ]);
      await offlineDB.putMany('bills',[{id:'qa_bill_r',billNo:'INV-01562',billNumber:'INV-01562',billType:'udhar_entry',customerId:'qa_customer_ramesh',customerName:'Ramesh Sharma',grandTotal:30000,totalAmount:30000,creditAmount:30000,createdAt:iso(40,10),status:'confirmed',sync_status:'synced'}]);
      return true;
    })()`);
    await navigate(client, `${FRONTEND_URL}/customers`);
    await waitForPage(client, "document.body.innerText.includes('Ramesh Sharma')");
    await client.evaluate(`(() => { const target=[...document.querySelectorAll('button')].find(node=>node.innerText.includes('Ramesh Sharma')); if(!target) throw new Error('Seeded customer row is not interactive'); target.click(); return true; })()`);
    await waitForPage(client, "document.body.innerText.includes('Record Udhar Payment') && document.body.innerText.includes('Ramesh Sharma') && document.body.innerText.includes('Udhar Ledger')"); await sleep(1_000);
    const audit = await client.evaluate(`(() => { const text=document.body.innerText; const card=(label)=>[...document.querySelectorAll('article')].map(node=>node.innerText.replace(/\\s+/g,' ')).find(value=>value.startsWith(label))||''; return {customers:card('Total Customers'),outstanding:card('Total Outstanding'),received:card('Received This Week'),selected:text.includes('Ramesh Sharma'),amountDue:text.includes('₹24,850'),ledger:text.includes('INV-01562'),sparks:document.querySelectorAll('.recharts-area-area').length}; })()`);
    assert(/4/.test(audit.customers),`Customer count mismatch: ${audit.customers}`); assert(audit.selected,`Customer workspace did not select the seeded customer: ${JSON.stringify(audit)}`); assert(audit.sparks>=6,`Expected six KPI sparklines, got ${audit.sparks}`);
    const desktop=await capture(client,'customers-desktop.png',1680,980); const mobileMetrics=await capture(client,'customers-mobile.png',390,844);
    const guardTriggered=await client.evaluate(`(() => { const input=document.querySelector('#customer-payment-amount'); const button=[...document.querySelectorAll('button')].find(node=>node.textContent?.trim()==='Collect Payment'); if(!input||!button)return false; const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set; setter.call(input,'999999'); input.dispatchEvent(new Event('input',{bubbles:true})); return button.disabled===true && document.body.innerText.includes('Payment cannot exceed the outstanding balance'); })()`);
    assert(guardTriggered,'Could not exercise overpayment guard');
    const runtimeErrors=await client.evaluate('window.__kiranaQaErrors||[]'); assert(runtimeErrors.length===0,`Browser runtime errors: ${runtimeErrors.join(' | ')}`);
    console.log(JSON.stringify({audit,desktop,mobile:mobileMetrics,runtimeErrors},null,2));
  } finally { client?.close(); chrome.kill(); }
}

main().catch((error)=>{console.error(error.stack??error);process.exitCode=1;});
