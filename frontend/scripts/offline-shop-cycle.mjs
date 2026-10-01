// Additional cashier scenarios for live-udhar-sync-smoke.mjs. All business
// writes go through visible forms; IndexedDB and API access only inspect results.
import { writeFile } from "node:fs/promises";
import path from "node:path";

export async function verifyOfflineShopCycle({ client, waitForPage, navigate, setOffline, pageHelpers, frontendUrl, apiUrl, product, outputDir }) {
  const click = (selector) => client.evaluateFunction(pageHelpers.click, selector);
  const clickText = (text, selector = "button") => client.evaluateFunction(pageHelpers.clickText, { selector, text });
  const fill = (selector, value) => client.evaluateFunction(pageHelpers.fill, { selector, value: String(value) });
  const wait = (fn, arg, timeout = 20000) => waitForPage(client, fn, arg, timeout);
  const go = async (route) => {
    await navigate(client, `${frontendUrl}${route}`);
    await client.evaluateFunction(pageHelpers.install, null);
  };
  const read = (store) => client.evaluateFunction((store) => window.__qaReadStore(store), store);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const request = (route) => client.evaluateFunction(async ({ apiUrl, route }) => {
    const session = JSON.parse(localStorage.getItem("kiranaos.auth.session.v1"));
    const response = await fetch(`${apiUrl}${route}`, { headers: {
      authorization: `Bearer ${session.accessToken}`,
      "x-device-id": localStorage.getItem("kiranaos_device_id"),
    } });
    const json = await response.json();
    if (!response.ok) throw new Error(`${route}: ${response.status}`);
    return json.data ?? json;
  }, { apiUrl, route });
  const sync = async () => {
    await setOffline(client, false);
    await go("/sync-status");
    await wait(() => Boolean(document.querySelector('[data-testid="button-force-sync"]')));
    await click('[data-testid="button-force-sync"]');
    await wait(async () => (await window.__qaReadStore("sync_outbox")).every((row) => row.status === "SYNCED"), null, 60000);
  };
  const stock = async (expected) => {
    await wait(async ({ id, expected }) => {
      const rows = await window.__qaReadStore("products");
      const row = rows.find((row) => row.id === id || row.server_id === id);
      return Number(row?.stockBaseQty ?? row?.stock_base_qty) === expected;
    }, { id: product.id, expected });
  };

  const title = `Offline shop expense ${Date.now()}`;
  await go("/expenses");
  await wait(() => [...document.querySelectorAll("button")].some((button) => button.textContent.includes("Add Expense")));
  await wait(() => [...document.querySelectorAll("p.font-display")].some((row) => row.textContent === "₹0"));
  const expectToday = (amount) => wait((expected) => {
    const heading = [...document.querySelectorAll("p")].find((row) => row.textContent === "Today's Expenses");
    return heading?.parentElement?.parentElement?.querySelector("p.font-display")?.textContent === expected;
  }, `₹${amount}`);
  await setOffline(client, true);
  await clickText("Add Expense");
  await fill('input[name="title"]', title);
  await fill('input[name="amount"]', 200);
  await click('[role="dialog"][aria-hidden="false"] button[type="submit"]');
  await wait((title) => [...document.querySelectorAll("tr")].some((row) => row.textContent.includes(title)), title);
  await expectToday(200);
  const clickExpense = (action) => client.evaluateFunction(({ title, action }) => {
    const row = [...document.querySelectorAll("tr")].find((row) => row.textContent.includes(title));
    if (!row) throw new Error("Expense row missing");
    row.querySelector(`button[aria-label="${action}"]`).click();
  }, { title, action });
  await clickExpense("Edit");
  await fill('input[name="amount"]', 225);
  await fill('[role="dialog"][aria-hidden="false"] input[type="password"]', "2468");
  await click('[role="dialog"][aria-hidden="false"] button[type="submit"]');
  await wait(async (title) => (await window.__qaReadStore("expenses")).some((row) => row.title === title && row.amount === 225), title);
  await expectToday(225);
  let outbox = await read("sync_outbox");
  assert(["CREATE_EXPENSE", "UPDATE_EXPENSE"].every((operation) => outbox.some((row) => row.operation_type === operation && row.status === "PENDING")), "Expense writes were not queued offline");
  await go("/expenses");
  await wait((title) => [...document.querySelectorAll("tr")].some((row) => row.textContent.includes(title) && row.textContent.includes("225")), title);
  await wait(() => Boolean(document.querySelector('[data-testid="expense-summary-status"]')));
  await expectToday(225);
  await wait(() => {
    const label = [...document.querySelectorAll("p")].find((row) => row.textContent === "Today's Expenses");
    const card = label?.parentElement?.parentElement;
    return card && !card.textContent.includes("…");
  });
  const expenseScreenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  await writeFile(path.join(outputDir, "expense-summary-offline.png"), Buffer.from(expenseScreenshot.data, "base64"));
  await sync();
  const expenses = await request("/expenses");
  const expenseRows = Array.isArray(expenses) ? expenses : expenses.expenses;
  assert(expenseRows.filter((row) => row.title === title && row.amount === 225).length === 1, "Expense create/edit did not reconcile exactly once");
  await go("/expenses");
  await wait((title) => [...document.querySelectorAll("tr")].some((row) => row.textContent.includes(title)), title);
  await setOffline(client, true);
  await clickExpense("Delete");
  await fill("#expense-delete-owner-pin", "2468");
  await clickText("Delete", '[role="dialog"] button');
  await wait((title) => ![...document.querySelectorAll("tr")].some((row) => row.textContent.includes(title)), title);
  await expectToday(0);
  await go("/expenses");
  await wait(() => Boolean(document.querySelector("table")) || document.body.innerText.includes("No expenses"));
  assert(!await client.evaluateFunction((title) => [...document.querySelectorAll("tr")].some((row) => row.textContent.includes(title)), title), "Deleted expense reappeared after offline reload");
  await expectToday(0);
  await sync();
  const remaining = await request("/expenses");
  assert(!(Array.isArray(remaining) ? remaining : remaining.expenses).some((row) => row.title === title), "Deleted expense remained on server");
  console.log("Offline expense create, edit, cached-row deletion, reload and sync passed.");

  await go("/inventory");
  await wait((name) => [...document.querySelectorAll("tr")].some((row) => row.textContent.includes(name)), product.name);
  await setOffline(client, true);
  await client.evaluateFunction((name) => [...document.querySelectorAll("tr")].find((row) => row.textContent.includes(name)).click(), product.name);
  await wait(() => Boolean(document.querySelector('[role="dialog"] input[type="number"]')));
  await fill('[role="dialog"] input[type="number"]', 3);
  await clickText("Save locally", '[role="dialog"] button');
  await wait(() => Boolean(document.querySelector('[role="dialog"] input[type="password"]')));
  await fill('[role="dialog"] input[type="password"]', "2468");
  await client.evaluate(`(() => {
    const input = document.querySelector('[role="dialog"] textarea');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, 'Offline stock receipt');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await click('[role="dialog"] button[type="submit"]');
  await wait(async () => (await window.__qaReadStore("sync_outbox")).some((row) => row.operation_type === "STOCK_PURCHASE" && row.status === "PENDING"));
  await stock(22); // 20 opening - 1 preceding credit sale + 3 received.
  await go("/billing");
  const productSelector = `[data-testid="product-card-${product.id}"]`;
  await wait((selector) => Boolean(document.querySelector(selector)), productSelector);
  await click(productSelector);
  await click('[data-testid="button-change-customer"]');
  await click('[data-testid="button-payment-cash"]');
  await wait(() => Boolean(document.querySelector('[data-testid="button-confirm-bill"]:not([disabled])')));
  await click('[data-testid="button-confirm-bill"]');
  await wait(async () => (await window.__qaReadStore("sync_outbox")).filter((row) => row.operation_type === "CREATE_BILL").length === 2);
  await stock(21);
  outbox = await read("sync_outbox");
  const cashSale = outbox.find((row) => row.operation_type === "CREATE_BILL" && row.status === "PENDING");
  assert(Boolean(cashSale), "Cash sale not saved offline");
  await go(`/bills/${cashSale.entity_id}`);
  await wait(() => [...document.querySelectorAll("button")].some((row) => row.textContent.includes("Return items")));
  await clickText("Return items");
  await fill('[role="dialog"] input[type="number"]', 1);
  await fill("#return-pin", "2468");
  await fill("#return-reason", "Offline QA return");
  await click('[data-testid="process-return"]');
  await wait(async () => (await window.__qaReadStore("sync_outbox")).some((row) => row.operation_type === "CREATE_SALE_RETURN" && row.status === "PENDING"));
  await stock(22);
  await go("/inventory");
  await stock(22);
  const queuedOperations = (await read("sync_outbox")).filter((row) => row.status === "PENDING").map((row) => row.operation_type);
  await sync();
  const serverProduct = await request(`/products/${product.id}`);
  assert(Number(serverProduct.stockBaseQty) === 22, `Server stock mismatch: ${serverProduct.stockBaseQty}`);
  const bills = await request("/bills?limit=100");
  const billRows = Array.isArray(bills) ? bills : bills.bills ?? bills.items;
  const normalBills = billRows.filter((row) => row.billType === "normal_sale");
  const returns = billRows.filter((row) => row.billType === "sales_return");
  assert(normalBills.length === 2 && returns.length === 1, `Unexpected sale/return counts: ${JSON.stringify(billRows.map((row) => ({ id: row.id, type: row.billType })))}`);
  assert(normalBills.every((row) => Number(row.grandTotal) === 200) && Math.abs(Number(returns[0].grandTotal)) === 200, "Sale/return totals do not reconcile");
  await go("/inventory");
  await stock(22);
  console.log("Offline stock intake, cash sale, linked return, reload and server stock reconciliation passed.");
  return { passed: true, expense: { created: 200, edited: 225, offlineReloadPreservedEditedRow: true, liveOfflineSummary: { afterCreate: 200, afterEdit: 225, afterReload: 225, afterDelete: 0, afterDeleteReload: 0 }, summaryFreshnessNotice: true, screenshot: "expense-summary-offline.png", deletedLocallyAndOnServer: true }, stock: { opening: 20, creditSale: -1, purchase: 3, cashSale: -1, return: 1, finalLocalAndServer: 22 }, queuedOperations, serverSales: normalBills.length, serverReturns: returns.length };
}
