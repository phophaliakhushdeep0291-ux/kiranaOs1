/**
 * The whole "add a product with several packagings" journey, driven through the real UI.
 *
 * Every check here started as a bug a shopkeeper hit: adding a second pack size and
 * typing how many you have used to fail the save outright, and re-opening the product
 * silently invented stock. Those are cheap to reintroduce from either side of the form,
 * so this walks the actual screen — fill, add two packs, save behind the owner PIN,
 * reopen, edit a pack count, save again — and asserts the server's stock after each step.
 *
 *   node scripts/capture-product-packaging-ui.mjs
 *   QA_FRONTEND_URL=http://localhost:51977 node scripts/capture-product-packaging-ui.mjs
 */
import { spawn } from "node:child_process";
import { writeFile, mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.QA_FRONTEND_URL || "http://localhost:5173";
const API_URL = process.env.QA_API_URL || "http://localhost:3000/api";
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.QA_DEBUG_PORT || 9461);
const OUTPUT_DIR = path.resolve(process.env.QA_OUTPUT_DIR || ".");
const OWNER_PIN = "2468";
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
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const response = await fetch(url); if (response.ok) return response; } catch { /* still starting */ }
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
  const diagnostic = await client.evaluate(`({ url: location.href, text: document.body?.innerText?.slice(0, 900) })`).catch(() => null);
  throw new Error(`Timed out waiting for: ${expression}\npage=${JSON.stringify(diagnostic)}`);
}

async function navigate(client, url) {
  await client.send("Page.navigate", { url });
  // readyState alone is satisfied by about:blank, and reading localStorage there
  // throws SecurityError — wait until the app's own origin is actually loaded.
  const origin = new URL(url).origin;
  await waitForPage(client, `document.readyState === 'complete' && location.origin === ${JSON.stringify(origin)}`);
}

async function screenshot(client, file) {
  await sleep(500);
  const image = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, file), Buffer.from(image.data, "base64"));
  return file;
}

function assert(value, message) { if (!value) throw new Error(message); }

/**
 * Page-side helpers, injected once.
 *
 * Inputs are set through the native value setter because React tracks the last
 * value it wrote and ignores an assignment it did not see; Radix selects are
 * opened and their option clicked, because the listbox is a portal that only
 * exists while open.
 */
const HELPERS = `
window.__qa = {
  set(node, value) {
    if (!node) throw new Error('set: node missing');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(node, String(value));
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new Event('change', { bubbles: true }));
  },
  panel() {
    return [...document.querySelectorAll('[role=dialog]')].find((d) => d.textContent.includes('Product name'));
  },
  packBox() { return document.querySelector('[data-testid="alternate-pack-sizes"]'); },
  /**
   * The "add a pack" draft alone.
   *
   * Every pack already added renders its own "Selling price" field inside the
   * same box, so a label lookup scoped to the box types into the FIRST pack row
   * instead of the draft — silently repricing a saved pack and leaving the draft
   * empty. The draft is the block holding the submit button.
   */
  draft() {
    const box = this.packBox();
    const submit = [...box.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Add pack to product');
    return submit ? submit.parentElement : null;
  },
  /**
   * The control under a caption, whatever element the caption happens to be.
   *
   * The product form's own Field stopped being a <label> when it was made to
   * describe its control with aria-labelledby instead: it is now a <span> whose
   * id the control points at, inside a role=group. Only the trade-attributes
   * section still uses real labels, so a lookup over <label> alone found nine
   * attribute captions and none of the fields this walkthrough fills in.
   */
  field(root, labelText) {
    const captions = [...root.querySelectorAll('label, [id^="product-field-label-"]')];
    const caption = captions.find((l) => l.textContent.trim().startsWith(labelText));
    if (!caption) throw new Error('field not found: ' + labelText + ' | on screen: '
      + captions.map((l) => l.textContent.trim()).join(' / '));
    const holder = caption.closest('[role=group]') || caption.parentElement;
    return holder.querySelector('input, textarea, [role=combobox], button[role=combobox]');
  },
  fill(root, labelText, value) { this.set(this.field(root, labelText), value); },
  button(root, text) {
    const b = [...root.querySelectorAll('button')].find((n) => n.textContent.trim() === text);
    if (!b) throw new Error('button not found: ' + text + ' | on screen: '
      + [...root.querySelectorAll('button')].map((n) => n.textContent.trim()).filter(Boolean).join(' / '));
    return b;
  },
  click(root, text) { this.button(root, text).click(); },
  // The stock-mode choices are cards: their text is the title AND its hint, so
  // they can only be matched on the prefix.
  clickPrefix(root, text) {
    const b = [...root.querySelectorAll('button')].find((n) => n.textContent.trim().startsWith(text));
    if (!b) throw new Error('button not found by prefix: ' + text + ' | on screen: '
      + [...root.querySelectorAll('button')].map((n) => n.textContent.trim()).filter(Boolean).join(' / '));
    b.click();
    return b;
  },
  async pick(trigger, optionText) {
    if (!trigger) throw new Error('pick: trigger missing');
    trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
    trigger.click();
    for (let i = 0; i < 40; i += 1) {
      const option = [...document.querySelectorAll('[role=option]')].find((o) => o.textContent.trim() === optionText);
      if (option) {
        option.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
        option.click();
        return true;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error('option not found: ' + optionText);
  },
  packRows() {
    const box = this.packBox();
    if (!box) return [];
    const names = [...box.querySelectorAll('p.truncate')].map((p) => p.textContent.trim());
    return names;
  },
  packField(packName, labelSuffix) {
    const input = [...this.packBox().querySelectorAll('input[aria-label]')]
      .find((i) => i.getAttribute('aria-label') === packName + ' ' + labelSuffix);
    if (!input) throw new Error('pack field not found: ' + packName + ' ' + labelSuffix);
    return input;
  },
  toasts() {
    return [...document.querySelectorAll('[role=status], [data-sonner-toast], li[data-state]')]
      .map((t) => t.innerText.trim()).filter(Boolean);
  },
};
true;
`;

async function serverProduct(token, deviceId, name) {
  const res = await fetch(`${API_URL}/products`, {
    headers: { authorization: `Bearer ${token}`, "x-device-id": deviceId },
  });
  const json = await res.json();
  return (json.data ?? []).find((p) => p.name === name) ?? null;
}

function packSummary(product) {
  return (product?.sellingUnits ?? [])
    .map((u) => `${u.unitCode} qty=${u.onHandQty} cost=${u.costPrice} price=${u.defaultPrice} conv=${u.conversionToBase}`)
    .sort();
}

async function main() {
  const problems = [];
  const profile = await mkdtemp(path.join(tmpdir(), "kirana-product-packaging-"));
  console.log("packaging-qa: starting Chrome", { DEBUG_PORT, profile, FRONTEND_URL });
  const chrome = spawn(CHROME_PATH, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run",
    "--no-default-browser-check", "--window-size=1440,1000",
    `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${profile}`,
    `${FRONTEND_URL}/register`,
  ], { windowsHide: true, stdio: "ignore" });

  const client = new CdpClient(
    (await (await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/list`)).json())
      .find((t) => t.type === "page").webSocketDebuggerUrl,
  );
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Log.enable");

  // Every failed request and page error is a candidate problem, not just the one we assert on.
  await client.send("Runtime.addBinding", { name: "__qaReport" }).catch(() => {});
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      window.__qaNetErrors = [];
      window.__qaPageErrors = [];
      addEventListener('error', (e) => window.__qaPageErrors.push(String(e.message)));
      addEventListener('unhandledrejection', (e) => window.__qaPageErrors.push(String(e.reason?.message ?? e.reason)));
      const of = window.fetch;
      window.fetch = async (...a) => {
        const res = await of(...a);
        try {
          if (!res.ok) {
            const body = await res.clone().text();
            window.__qaNetErrors.push(res.status + ' ' + String(a[0]).replace(location.origin, '') + ' :: ' + body.slice(0, 300));
          }
        } catch {}
        return res;
      };
    `,
  });

  try {
    await navigate(client, `${FRONTEND_URL}/register`);

    const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
    const mobile = `9${runId.slice(-9)}`;
    console.log("packaging-qa: registering QA shop");
    const auth = await client.evaluate(`(async () => {
      const apiUrl = ${JSON.stringify(API_URL)};
      // Reuse the device id the app already minted on boot: a JWT is bound to the
      // device it was issued for, so inventing a second one logs straight back out.
      const deviceId = localStorage.getItem('kiranaos_device_id')
        || localStorage.getItem('kirana-os:device-id:v1')
        || 'packaging_qa_${runId}';
      const response = await fetch(apiUrl + '/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-device-id': deviceId },
        body: JSON.stringify({
          shopName: 'Packaging QA Store', ownerName: 'KiranaOS QA', city: 'Jodhpur',
          address: 'Packaging QA Lane 12', mobile: ${JSON.stringify(mobile)},
          password: 'Test@12345', ownerPin: ${JSON.stringify(OWNER_PIN)},
        }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(JSON.stringify(json));
      const auth = json.data ?? json;
      localStorage.setItem('kiranaApiBaseUrl', apiUrl);
      localStorage.setItem('kiranaos_device_id', deviceId);
      localStorage.setItem('kirana-os:device-id:v1', deviceId);
      localStorage.setItem('kiranaos.auth.session.v1', JSON.stringify({
        accessToken: auth.accessToken ?? auth.token, refreshToken: auth.refreshToken,
        user: auth.user, shop: auth.shop,
      }));
      sessionStorage.setItem('kiranaos.security.sessionStarted.v1', String(Date.now()));
      // The shop boots in Hindi, and every label this walkthrough looks for is
      // written in English. Pin the language rather than translating the queries.
      localStorage.setItem('kirana-os:ui-language:v1', 'en');
      return { token: auth.accessToken ?? auth.token, deviceId };
    })()`);

    await navigate(client, `${FRONTEND_URL}/products`);
    await waitForPage(client, `!!document.body.innerText.includes('Add Product')`);
    await client.evaluate(HELPERS);

    // ── 1. open the panel and describe an ordinary 1 kg packet ──────────────
    console.log("packaging-qa: filling the product");
    await client.evaluate(`__qa.click(document, 'Add Product')`);
    await waitForPage(client, `!!__qa.panel()`);
    await client.evaluate(HELPERS);

    await client.evaluate(`(() => {
      const p = __qa.panel();
      __qa.fill(p, 'Product name', 'Ashirvaad Atta');
      // "Sold As" renames the size question ("One piece contains" -> "One packet
      // contains"), so React has to re-render before that field can be found.
      __qa.click(p, 'packet');
      return true;
    })()`);
    await waitForPage(client, `!!__qa.panel().querySelector('[data-testid="input-pack-size"]')`);
    await sleep(300);
    await client.evaluate(`(async () => {
      const p = __qa.panel();
      const sizeBox = p.querySelector('[data-testid="input-pack-size"]');
      // The measure select sits beside the size box inside the same Field.
      const measure = sizeBox.closest('div').querySelector('[role=combobox]')
        ?? [...p.querySelectorAll('[role=combobox]')].find((c) => c.textContent.trim() === 'piece');
      await __qa.pick(measure, 'kg');
      return true;
    })()`);
    await sleep(300);
    await client.evaluate(`(() => {
      const p = __qa.panel();
      __qa.set(p.querySelector('[data-testid="input-pack-size"]'), '1');
      __qa.fill(p, 'MRP', '300');
      __qa.fill(p, 'Cost Price', '240');
      __qa.fill(p, 'Selling Price', '280');
      __qa.fill(p, 'Opening Stock', '10');
      __qa.fill(p, 'Low Stock Alert', '2');
      return true;
    })()`);

    // ── 2. count each size, then add TWO more packagings ────────────────────
    console.log("packaging-qa: switching to per-pack counting");
    await client.evaluate(`(() => { __qa.clickPrefix(__qa.packBox(), 'Count each size'); return true; })()`);
    await sleep(300);

    async function addPack({ contains, measure, price, cost, openingQty }) {
      await client.evaluate(`(async () => {
        const box = __qa.packBox();
        if (!box.textContent.includes('Add pack to product')) __qa.click(box, 'Add size');
        await new Promise((r) => setTimeout(r, 250));
        await __qa.pick(__qa.field(__qa.draft(), 'Measure'), ${JSON.stringify(measure)});
        return true;
      })()`);
      await sleep(250);
      await client.evaluate(`(() => {
        const b = __qa.draft();
        __qa.fill(b, 'One packet contains', ${JSON.stringify(String(contains))});
        __qa.fill(b, 'Selling price', ${JSON.stringify(String(price))});
        __qa.set(b.querySelector('[data-testid="input-extra-pack-cost"]'), ${JSON.stringify(cost === null ? "" : String(cost))});
        __qa.set(b.querySelector('[data-testid="input-extra-pack-opening-qty"]'), ${JSON.stringify(String(openingQty))});
        return true;
      })()`);
      const before = await client.evaluate(`__qa.packRows().length`);
      await client.evaluate(`(() => { __qa.click(__qa.packBox(), 'Add pack to product'); return true; })()`);
      await sleep(400);
      const after = await client.evaluate(`__qa.packRows()`);
      assert(after.length === before + 1, `pack ${contains} ${measure} was not added; rows=${JSON.stringify(after)} toasts=${JSON.stringify(await client.evaluate(`__qa.toasts()`))}`);
      console.log(`packaging-qa:   + ${contains} ${measure} -> rows ${JSON.stringify(after)}`);
    }

    await addPack({ contains: 5, measure: "kg", price: 1350, cost: 1180, openingQty: 4 });
    await addPack({ contains: 500, measure: "gram", price: 150, cost: null, openingQty: 20 });

    await screenshot(client, "product-packaging-form.png");

    // What the shopkeeper is looking at before pressing Save.
    const formState = await client.evaluate(`(() => {
      const box = __qa.packBox();
      return {
        rows: __qa.packRows(),
        fields: [...box.querySelectorAll('input[aria-label]')].map((i) => i.getAttribute('aria-label') + '=' + (i.value || '(blank ph:' + i.placeholder + ')')),
      };
    })()`);
    console.log("packaging-qa: pack rows on screen", JSON.stringify(formState, null, 1));

    // ── 3. save, through the owner-PIN gate ─────────────────────────────────
    console.log("packaging-qa: saving");
    await client.evaluate(`(() => { __qa.click(document, 'Save Product'); return true; })()`);
    await waitForPage(client, `[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].some((d) => d.textContent.includes('Owner'))`);
    await client.evaluate(`(() => {
      const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find((n) => n.textContent.includes('Owner PIN'));
      const pin = d.querySelector('input[type=password], input[placeholder*="PIN"], input');
      __qa.set(pin, ${JSON.stringify(OWNER_PIN)});
      const reason = [...d.querySelectorAll('input,textarea')].find((n) => /reason/i.test(n.placeholder || n.name || ''));
      if (reason) __qa.set(reason, 'Packaging QA walkthrough');
      __qa.click(d, 'Create product');
      return true;
    })()`);
    await sleep(2500);

    const created = await serverProduct(auth.token, auth.deviceId, "Ashirvaad Atta");
    assert(created, `product never reached the server. net=${JSON.stringify(await client.evaluate(`window.__qaNetErrors`))} toasts=${JSON.stringify(await client.evaluate(`__qa.toasts()`))}`);

    // 10 x 1 kg + 4 x 5 kg + 20 x 500 g = 10000 + 20000 + 10000 = 40000 g
    console.log("packaging-qa: created", { stockBaseQty: created.stockBaseQty, packagingMode: created.packagingMode });
    console.log("packaging-qa: packs", packSummary(created));
    if (created.stockBaseQty !== 40000) problems.push(`create: stockBaseQty ${created.stockBaseQty}, expected 40000`);
    if (created.packagingMode !== "per_pack") problems.push(`create: packagingMode ${created.packagingMode}`);
    const cost5kg = created.sellingUnits.find((u) => u.unitCode.includes("5-kg"))?.costPrice;
    if (Number(cost5kg) !== 1180) problems.push(`create: 5 kg pack cost ${cost5kg}, expected 1180`);

    // ── 4. reopen for edit — this is where stock used to inflate ────────────
    console.log("packaging-qa: reopening the saved product");
    await navigate(client, `${FRONTEND_URL}/products`);
    await waitForPage(client, `!!document.body.innerText.includes('Ashirvaad Atta')`);
    await client.evaluate(HELPERS);
    await client.evaluate(`(async () => {
      const row = [...document.querySelectorAll('tr')].find((r) => r.textContent.includes('Ashirvaad Atta'));
      const trigger = row.querySelector('button[aria-label^="Actions"]');
      // A Radix dropdown opens on pointerdown, not click, and its items live in a
      // portal — the sidebar uses role=menuitem too, so pick the menu that has Edit.
      trigger.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
      trigger.click();
      for (let i = 0; i < 40; i += 1) {
        const menu = [...document.querySelectorAll('[role=menu]')]
          .find((m) => [...m.querySelectorAll('[role=menuitem]')].some((x) => x.textContent.trim() === 'Edit'));
        if (menu) {
          const edit = [...menu.querySelectorAll('[role=menuitem]')].find((x) => x.textContent.trim() === 'Edit');
          edit.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, isPrimary: true }));
          edit.click();
          return true;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error('Edit action never appeared');
    })()`);
    // Wait for the EDIT panel specifically. A blank "Add Product" panel also
    // contains "Product name", so waiting on the dialog alone reads an empty form
    // and reports the packs as missing when they were simply never loaded.
    await waitForPage(client, `(() => {
      const p = __qa.panel();
      if (!p) return false;
      const name = [...p.querySelectorAll('input')].find((i) => i.value === 'Ashirvaad Atta');
      return !!name;
    })()`);
    await client.evaluate(HELPERS);
    await sleep(600);
    await screenshot(client, "product-packaging-reopened.png");

    const reopened = await client.evaluate(`(() => {
      const p = __qa.panel();
      return {
        openingStock: __qa.field(p, 'Opening Stock').value,
        lowStock: __qa.field(p, 'Low Stock Alert').value,
        rows: __qa.packRows(),
        packFields: [...__qa.packBox().querySelectorAll('input[aria-label]')].map((i) => i.getAttribute('aria-label') + '=' + (i.value || '(blank ph:' + i.placeholder + ')')),
      };
    })()`);
    console.log("packaging-qa: reopened", JSON.stringify(reopened, null, 1));
    // The main stock box describes the DEFAULT pack alone, not the whole shelf.
    if (reopened.openingStock !== "10") problems.push(`edit: Opening Stock reads ${reopened.openingStock}, expected 10 (the 1 kg pack's own count)`);
    if (reopened.rows.length !== 2) problems.push(`edit: pack rows read ${JSON.stringify(reopened.rows)}, expected the 5 kg and 500 g packs`);

    // ── 5. change one pack's count and save again ───────────────────────────
    console.log("packaging-qa: raising the 500 g count 20 -> 26");
    await client.evaluate(`(() => { __qa.set(__qa.packField('packet 500 gram', 'in stock'), '26'); return true; })()`);
    // The same control is labelled "Update Product" once the panel is editing.
    await client.evaluate(`(() => { __qa.clickPrefix(document, 'Update Product'); return true; })()`);
    await sleep(1200);
    const needsPin = await client.evaluate(`[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].some((d) => d.textContent.includes('Owner PIN'))`);
    if (needsPin) {
      await client.evaluate(`(() => {
        const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find((n) => n.textContent.includes('Owner PIN'));
        __qa.set(d.querySelector('input[type=password], input[placeholder*="PIN"], input'), ${JSON.stringify(OWNER_PIN)});
        const reason = [...d.querySelectorAll('input,textarea')].find((n) => /reason/i.test(n.placeholder || n.name || ''));
        if (reason) __qa.set(reason, 'Packaging QA recount');
        const go = [...d.querySelectorAll('button')].find((b) => /save|update|confirm|product/i.test(b.textContent));
        go.click();
        return true;
      })()`);
    }
    await sleep(2500);

    const edited = await serverProduct(auth.token, auth.deviceId, "Ashirvaad Atta");
    // 10 x 1 kg + 4 x 5 kg + 26 x 500 g = 10000 + 20000 + 13000 = 43000 g
    console.log("packaging-qa: after edit", { stockBaseQty: edited?.stockBaseQty });
    console.log("packaging-qa: packs", packSummary(edited));
    if (edited?.stockBaseQty !== 43000) problems.push(`edit: stockBaseQty ${edited?.stockBaseQty}, expected 43000`);

    // ── 6. the same packs entered the OTHER way round ───────────────────────
    // "Stock counting" starts on "One shared stock", so most shops add their pack
    // sizes there and only then decide they want each size counted apart. Flipping
    // the switch used to re-label the whole shelf as default packs (both other rows
    // read zero) and flipping it back threw their counts away outright.
    console.log("packaging-qa: pooled first, then switching to per-pack");
    await navigate(client, `${FRONTEND_URL}/products`);
    await waitForPage(client, `!!document.body.innerText.includes('Add Product')`);
    await client.evaluate(HELPERS);
    await client.evaluate(`__qa.click(document, 'Add Product')`);
    await waitForPage(client, `!!__qa.panel()`);
    await client.evaluate(HELPERS);

    await client.evaluate(`(() => {
      const p = __qa.panel();
      __qa.fill(p, 'Product name', 'Tata Salt');
      __qa.click(p, 'packet');
      return true;
    })()`);
    await waitForPage(client, `!!__qa.panel().querySelector('[data-testid="input-pack-size"]')`);
    await sleep(300);
    await client.evaluate(`(async () => {
      const p = __qa.panel();
      const sizeBox = p.querySelector('[data-testid="input-pack-size"]');
      await __qa.pick(sizeBox.closest('div').querySelector('[role=combobox]'), 'kg');
      return true;
    })()`);
    await sleep(300);
    await client.evaluate(`(() => {
      const p = __qa.panel();
      __qa.set(p.querySelector('[data-testid="input-pack-size"]'), '1');
      __qa.fill(p, 'MRP', '30');
      __qa.fill(p, 'Cost Price', '20');
      __qa.fill(p, 'Selling Price', '25');
      __qa.fill(p, 'Opening Stock', '10');
      return true;
    })()`);

    // Added while still pooled — the counts go into the shared pool.
    await addPack({ contains: 5, measure: "kg", price: 140, cost: 95, openingQty: 4 });
    await addPack({ contains: 500, measure: "gram", price: 15, cost: null, openingQty: 20 });

    const pooledStock = await client.evaluate(`__qa.field(__qa.panel(), 'Opening Stock').value`);
    console.log("packaging-qa: pooled opening stock reads", pooledStock);
    // 10 x 1 kg + 4 x 5 kg + 20 x 500 g = 40 one-kg packets.
    if (pooledStock !== "40") problems.push(`pooled: Opening Stock reads ${pooledStock}, expected 40`);

    console.log("packaging-qa: flipping to Count each size");
    await client.evaluate(`(() => { __qa.clickPrefix(__qa.packBox(), 'Count each size'); return true; })()`);
    await sleep(400);
    const afterSwitch = await client.evaluate(`(() => ({
      openingStock: __qa.field(__qa.panel(), 'Opening Stock').value,
      packFields: [...__qa.packBox().querySelectorAll('input[aria-label]')]
        .filter((i) => i.getAttribute('aria-label').includes('in stock'))
        .map((i) => i.getAttribute('aria-label') + '=' + (i.value || '(blank ph:' + i.placeholder + ')')),
    }))()`);
    console.log("packaging-qa: after the switch", JSON.stringify(afterSwitch));
    // The main box now describes the 1 kg packet alone, and each size keeps its own count.
    if (afterSwitch.openingStock !== "10") problems.push(`switch: Opening Stock reads ${afterSwitch.openingStock}, expected 10`);
    if (!afterSwitch.packFields.includes("packet 5 kg in stock=4")) problems.push(`switch: 5 kg count lost — ${JSON.stringify(afterSwitch.packFields)}`);
    if (!afterSwitch.packFields.includes("packet 500 gram in stock=20")) problems.push(`switch: 500 g count lost — ${JSON.stringify(afterSwitch.packFields)}`);
    await screenshot(client, "product-packaging-mode-switch.png");

    await client.evaluate(`(() => { __qa.clickPrefix(document, 'Save Product'); return true; })()`);
    await waitForPage(client, `[...document.querySelectorAll('[role=dialog],[role=alertdialog]')].some((d) => d.textContent.includes('Owner'))`);
    await client.evaluate(`(() => {
      const d = [...document.querySelectorAll('[role=dialog],[role=alertdialog]')].find((n) => n.textContent.includes('Owner PIN'));
      __qa.set(d.querySelector('input[type=password], input[placeholder*="PIN"], input'), ${JSON.stringify(OWNER_PIN)});
      const reason = [...d.querySelectorAll('input,textarea')].find((n) => /reason/i.test(n.placeholder || n.name || ''));
      if (reason) __qa.set(reason, 'Packaging QA mode switch');
      __qa.click(d, 'Create product');
      return true;
    })()`);
    await sleep(2500);

    const salt = await serverProduct(auth.token, auth.deviceId, "Tata Salt");
    console.log("packaging-qa: switched product", { stockBaseQty: salt?.stockBaseQty, packagingMode: salt?.packagingMode });
    console.log("packaging-qa: packs", packSummary(salt));
    if (!salt) problems.push("switch: Tata Salt never reached the server");
    // Nothing was added or removed by flipping a display switch: still 40 kg.
    if (salt && salt.stockBaseQty !== 40000) problems.push(`switch: stockBaseQty ${salt.stockBaseQty}, expected 40000`);
    const saltByCode = Object.fromEntries((salt?.sellingUnits ?? []).map((u) => [u.unitCode, u.onHandQty]));
    if (salt && saltByCode["packet-5-kg"] !== 4) problems.push(`switch: 5 kg saved as ${saltByCode["packet-5-kg"]}, expected 4`);
    if (salt && saltByCode["packet-500-gram"] !== 20) problems.push(`switch: 500 g saved as ${saltByCode["packet-500-gram"]}, expected 20`);
    if (salt && saltByCode["packet-1-kg"] !== 10) problems.push(`switch: 1 kg saved as ${saltByCode["packet-1-kg"]}, expected 10`);

    // ── 7. the two ways one pack can be entered twice ───────────────────────
    // Both end with a shopkeeper unable to tell two rows apart: same physical size
    // under a different measure, and one barcode naming more than one pack.
    console.log("packaging-qa: duplicate guards");
    await navigate(client, `${FRONTEND_URL}/products`);
    await waitForPage(client, `!!document.body.innerText.includes('Add Product')`);
    await client.evaluate(HELPERS);
    await client.evaluate(`__qa.click(document, 'Add Product')`);
    await waitForPage(client, `!!__qa.panel()`);
    await client.evaluate(HELPERS);
    await client.evaluate(`(() => {
      const p = __qa.panel();
      __qa.fill(p, 'Product name', 'Duplicate Guard Atta');
      __qa.click(p, 'packet');
      return true;
    })()`);
    await waitForPage(client, `!!__qa.panel().querySelector('[data-testid="input-pack-size"]')`);
    await sleep(300);
    await client.evaluate(`(async () => {
      const p = __qa.panel();
      await __qa.pick(p.querySelector('[data-testid="input-pack-size"]').closest('div').querySelector('[role=combobox]'), 'kg');
      return true;
    })()`);
    await sleep(300);
    await client.evaluate(`(() => {
      const p = __qa.panel();
      __qa.set(p.querySelector('[data-testid="input-pack-size"]'), '1');
      __qa.fill(p, 'MRP', '300');
      __qa.fill(p, 'Cost Price', '240');
      __qa.fill(p, 'Selling Price', '280');
      __qa.fill(p, 'Opening Stock', '5');
      __qa.set(p.querySelector('input[placeholder*="barcode"], input[placeholder*="Scan"]'), '8901234567890');
      return true;
    })()`);

    async function tryPack({ contains, measure, price, barcode = "" }) {
      await client.evaluate(`(async () => {
        const box = __qa.packBox();
        if (!box.textContent.includes('Add pack to product')) __qa.click(box, 'Add size');
        await new Promise((r) => setTimeout(r, 250));
        await __qa.pick(__qa.field(__qa.draft(), 'Measure'), ${JSON.stringify(measure)});
        return true;
      })()`);
      await sleep(250);
      await client.evaluate(`(() => {
        const b = __qa.draft();
        __qa.fill(b, 'One packet contains', ${JSON.stringify(String(contains))});
        __qa.fill(b, 'Selling price', ${JSON.stringify(String(price))});
        __qa.fill(b, 'Pack barcode', ${JSON.stringify(barcode)});
        return true;
      })()`);
      const before = await client.evaluate(`__qa.packRows().length`);
      await client.evaluate(`(() => { __qa.click(__qa.packBox(), 'Add pack to product'); return true; })()`);
      await sleep(500);
      const after = await client.evaluate(`__qa.packRows()`);
      return { added: after.length > before, rows: after, toasts: await client.evaluate(`__qa.toasts()`) };
    }

    // 1000 gram IS the 1 kg packet already on the product, spelled the other way.
    const sameSize = await tryPack({ contains: 1000, measure: "gram", price: 280 });
    console.log("packaging-qa:   1000 gram against a 1 kg default ->", JSON.stringify(sameSize));
    if (sameSize.added) problems.push("duplicate: a 1000 gram packet was added alongside the 1 kg packet — same pack, two shelves");

    // A real second size, but wearing the product's own barcode.
    const sameBarcode = await tryPack({ contains: 5, measure: "kg", price: 1350, barcode: "8901234567890" });
    console.log("packaging-qa:   5 kg reusing the product barcode ->", JSON.stringify(sameBarcode));
    if (sameBarcode.added) problems.push("duplicate: a pack took a barcode already in use — one scan now matches two packs");

    // The same size WITHOUT the clash still has to go on, or the guard is too eager.
    const genuine = await tryPack({ contains: 5, measure: "kg", price: 1350, barcode: "8909999999999" });
    console.log("packaging-qa:   5 kg with its own barcode ->", JSON.stringify(genuine.rows));
    if (!genuine.added) problems.push("duplicate: the guard blocked a genuinely new pack — " + JSON.stringify(genuine.toasts));

    const netErrors = await client.evaluate(`window.__qaNetErrors`);
    const pageErrors = await client.evaluate(`window.__qaPageErrors`);
    const packagingErrors = (netErrors ?? []).filter((e) => e.includes("PACKAGING") || e.includes("products"));
    if (packagingErrors.length) problems.push(`network: ${JSON.stringify(packagingErrors)}`);

    console.log("\npackaging-qa: page errors", JSON.stringify(pageErrors ?? []));
    console.log("packaging-qa: failed requests", JSON.stringify(netErrors ?? [], null, 1));

    if (problems.length) {
      console.log("\nPROBLEMS FOUND:");
      for (const p of problems) console.log("  - " + p);
      process.exitCode = 1;
    } else {
      console.log("\npackaging-qa: OK — created, reopened and re-saved a 3-packaging product, and moved one between stock-counting modes, with no stock drift");
    }
  } finally {
    client.close();
    chrome.kill();
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
