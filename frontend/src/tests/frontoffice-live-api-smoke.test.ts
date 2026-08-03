import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { setApiBaseUrl, setAuthTokenGetter, apiRequest, ApiClientError } from "@/lib/api/http";
import { saveAuthSession, clearAuthStorage } from "@/lib/storage/auth-storage";
import { register, login, setOwnerPin } from "@/features/core/auth/api";
import { activateDevice } from "@/features/core/devices/api";
import { createProduct, listProducts } from "@/features/core/products/api";
import { createCustomer, getCustomerKhata } from "@/features/core/customers/api";
import { createBill, listBills } from "@/features/core/billing/api";
import { recordUdharPayment } from "@/features/core/payments/api";
import { getUdharSummary } from "@/features/core/ledger/api";
import { recordPurchase, getInventory, getStockLedger } from "@/features/core/inventory/api";
import { getPaymentSummary } from "@/features/core/reports/api";
import { BillInputBillType, BillPaymentMode, type AuthResponse, type Customer, type Product } from "@/types/api";

const runLiveSmoke = process.env.RUN_FRONTEND_LIVE_API_SMOKE === "true";
const describeLive = runLiveSmoke ? describe : describe.skip;

function createMemoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: vi.fn(() => data.clear()),
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    key: vi.fn((index: number) => Array.from(data.keys())[index] ?? null),
    removeItem: vi.fn((key: string) => {
      data.delete(key);
    }),
    setItem: vi.fn((key: string, value: string) => {
      data.set(key, String(value));
    }),
  };
}

function asNumber(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function suffix() {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

function mobileFromSuffix(id: string) {
  return `9${id.replace(/\D/g, "").slice(-9).padStart(9, "0")}`;
}

function storeSession(session: AuthResponse) {
  saveAuthSession({
    accessToken: session.accessToken || session.token,
    refreshToken: session.refreshToken,
    user: session.user,
    shop: session.shop ?? null,
  });
  setAuthTokenGetter(() => session.accessToken || session.token || null);
}

describeLive("frontend live API smoke", () => {
  const apiBaseUrl = process.env.FRONTEND_LIVE_API_BASE_URL || "http://127.0.0.1:3000/api";
  const ownerPin = "1234";
  const password = "Test@12345";
  const id = suffix();
  const deviceId = `qa-device-${id}`;
  const mobile = mobileFromSuffix(id);
  let product: Product;
  let customer: Customer;

  beforeAll(async () => {
    if (typeof fetch !== "function") throw new Error("Global fetch is required for the frontend live API smoke");

    const localStorage = createMemoryStorage();
    const sessionStorage = createMemoryStorage();
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("sessionStorage", sessionStorage);
    vi.stubGlobal("navigator", { onLine: true, userAgent: "vitest-frontend-live-smoke" });
    vi.stubGlobal("window", {
      localStorage,
      sessionStorage,
      dispatchEvent: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });

    setApiBaseUrl(apiBaseUrl);
    localStorage.setItem("kirana-os:device-id:v1", deviceId);

    await fetch(`${apiBaseUrl.replace(/\/api$/, "")}/health/ready`).then((response) => {
      if (!response.ok) throw new Error(`Backend health check failed with ${response.status}`);
    });

    const registered = await register({
      shopName: `Frontend Smoke Store ${id}`,
      ownerName: "Frontend Smoke Owner",
      city: "Jodhpur",
      address: "QA Street, Jodhpur",
      mobile,
      password,
      ownerPin,
    });
    storeSession(registered);

    const loggedIn = await login({ mobile, password });
    storeSession(loggedIn);
    await setOwnerPin(ownerPin);
    await activateDevice("Frontend smoke device", deviceId);
  }, 30_000);

  afterAll(() => {
    setAuthTokenGetter(() => null);
    clearAuthStorage();
    vi.unstubAllGlobals();
  });

  it("creates products, bills, udhar payments/reversal, purchase entries, and reads reports through frontend APIs", async () => {
    product = await createProduct({
      name: `QA Sugar ${id}`,
      category: "QA",
      displayUnit: "kg",
      baseUnit: "kg",
      rateUnit: "kg",
      unit: "kg",
      stockBaseQty: 25,
      costPerRateUnit: 40,
      averageCostPrice: 40,
      minPricePerRateUnit: 35,
      defaultPricePerRateUnit: 50,
      sellingPrice: 50,
      lowStockThreshold: 2,
      gstRate: 0,
      isLooseItem: true,
      ownerPin,
    });
    expect(product.id).toBeTruthy();

    const products = await listProducts({ search: `QA Sugar ${id}` });
    expect(products.some((row) => row.id === product.id)).toBe(true);

    customer = await createCustomer({
      name: `QA Customer ${id}`,
      mobile: mobileFromSuffix(`${Number(id) + 1}`),
      type: "udhar",
    });
    expect(customer.id).toBeTruthy();

    const creditBill = await createBill({
      billType: BillInputBillType.normal_sale,
      customerId: customer.id,
      customerName: customer.name,
      items: [
        {
          productId: product.id,
          name: product.name,
          quantity: 4,
          enteredUnit: "kg",
          ratePerRateUnit: 50,
          gstRate: 0,
        },
      ],
      discount: 0,
      actualAmount: 200,
      buyerPaidAmount: 0,
      payments: [{ mode: BillPaymentMode.credit, amount: 200 }],
    });
    expect(asNumber(creditBill.grandTotal ?? creditBill.totalAmount)).toBe(200);
    expect(asNumber(creditBill.paidAmount ?? creditBill.buyerPaidAmount)).toBe(0);

    let khata = await getCustomerKhata(customer.id);
    expect(asNumber(khata.totalOutstanding ?? khata.customer?.udharAmount)).toBe(200);

    const paymentOne = await recordUdharPayment(customer.id, {
      amount: 100,
      mode: "cash",
      note: "Frontend smoke payment one",
      idempotencyKey: `qa-payment-one-${id}`,
      localLedgerEntryId: `qa-ledger-one-${id}`,
      clientLedgerId: `qa-ledger-one-${id}`,
    } as never) as { ledgerEntryId: string; newBalance: number; amountPaid: number };
    expect(paymentOne).toEqual(expect.objectContaining({ amountPaid: 100, newBalance: 100 }));

    const paymentTwo = await recordUdharPayment(customer.id, {
      amount: 100,
      mode: "cash",
      note: "Frontend smoke payment two",
      idempotencyKey: `qa-payment-two-${id}`,
      localLedgerEntryId: `qa-ledger-two-${id}`,
      clientLedgerId: `qa-ledger-two-${id}`,
    } as never) as { ledgerEntryId: string; newBalance: number; amountPaid: number };
    expect(paymentTwo).toEqual(expect.objectContaining({ amountPaid: 100, newBalance: 0 }));

    await expect(recordUdharPayment(customer.id, {
      amount: 1,
      mode: "cash",
      note: "Expected overpayment rejection",
      idempotencyKey: `qa-overpay-${id}`,
      localLedgerEntryId: `qa-ledger-overpay-${id}`,
      clientLedgerId: `qa-ledger-overpay-${id}`,
    } as never)).rejects.toMatchObject({
      status: 400,
      data: expect.objectContaining({ code: "UDHAR_PAYMENT_EXCEEDS_OUTSTANDING" }),
    } satisfies Partial<ApiClientError>);

    const reversed = await apiRequest<{ newBalance: number; amountReversed: number }>(
      `/customers/${customer.id}/udhar-payment/${paymentTwo.ledgerEntryId}/reverse`,
      {
        method: "POST",
        body: JSON.stringify({ reason: "Frontend smoke reversal" }),
        ownerPin,
      },
    );
    expect(reversed).toEqual(expect.objectContaining({ amountReversed: 100, newBalance: 100 }));

    khata = await getCustomerKhata(customer.id);
    expect(asNumber(khata.totalOutstanding ?? khata.customer?.udharAmount)).toBe(100);

    const summary = await getUdharSummary();
    expect(summary.customers.some((row) => row.customerId === customer.id && row.outstanding === 100)).toBe(true);

    const purchasePayload = {
      productId: product.id,
      supplierName: `QA Supplier ${id}`,
      quantity: 10,
      enteredUnit: "kg",
      billAmount: 500,
      purchasePaymentStatus: "partial",
      purchasePaymentMode: "cash",
      purchasePaidAmount: 200,
      purchaseDueAmount: 300,
      purchaseDueDate: "2026-06-30",
      note: "Frontend smoke purchase",
      updateCost: true,
      ownerPin,
    };

    const purchase = await recordPurchase(purchasePayload as never) as {
      productId: string;
      qtyAdded: number;
      newStock: number;
      purchasePaymentStatus: string;
      purchasePaidAmount: number;
      purchaseDueAmount: number;
      purchaseDueDate: string | null;
    };
    expect(purchase).toEqual(expect.objectContaining({
      productId: product.id,
      qtyAdded: 10,
      newStock: 31,
      purchasePaymentStatus: "partial",
      purchasePaidAmount: 200,
      purchaseDueAmount: 300,
      purchaseDueDate: "2026-06-30",
    }));

    const inventory = await getInventory();
    expect(inventory.find((row) => row.id === product.id)).toEqual(expect.objectContaining({ stockBaseQty: 31 }));

    const purchaseLedger = await getStockLedger({ productId: product.id, action: "purchase", limit: 20 });
    expect(purchaseLedger.entries.length).toBeGreaterThan(0);

    const bills = await listBills({ customerId: customer.id, status: "all", limit: 20 });
    expect(bills.bills.some((row) => row.id === creditBill.id)).toBe(true);

    const payments = await getPaymentSummary();
    expect(asNumber(payments.cash)).toBe(0);
    expect(asNumber(payments.credit)).toBeGreaterThanOrEqual(200);
    expect(asNumber(payments.oldUdharRecovered)).toBeGreaterThanOrEqual(100);
    expect(asNumber(payments.cashInHand)).toBeGreaterThanOrEqual(100);
    expect(asNumber(payments.purchaseCashPaid)).toBeGreaterThanOrEqual(200);
    expect(asNumber(payments.purchaseDue)).toBeGreaterThanOrEqual(300);
  }, 45_000);
});
