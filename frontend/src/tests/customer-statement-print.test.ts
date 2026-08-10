import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "@/lib/escape-html";

function source(relativePath: string) {
  return readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), "utf8");
}

describe("customer statement printing", () => {
  it("escapes customer and ledger text before writing generated HTML", () => {
    expect(escapeHtml(`<img src=x onerror="alert('x')"> & shop`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt; &amp; shop",
    );
  });

  it("interpolates translated headings instead of printing JSX expressions literally", () => {
    const customersPage = source("../features/core/customers/pages/CustomersPage.tsx");
    const detailPage = source("../features/core/customers/pages/CustomerDetailPage.tsx");

    expect(customersPage).toContain('${escapeHtml(t("customers.ledger.udharAmount"))}');
    expect(customersPage).toContain('${escapeHtml(t("customers.ledger.empty"))}');
    expect(customersPage).not.toContain('>{t("customers.ledger.udharAmount")}</th>');
    expect(detailPage).toContain("escapeHtml(row.note)");
    expect(detailPage).toContain("const safeCustomerName = escapeHtml(customerName)");
  });

  it("sanitizes public order and product names on other generated print surfaces", () => {
    const ordersPage = source("../features/core/orders/pages/OrdersReceivedPage.tsx");
    const closingPage = source("../features/core/reports/pages/DailyClosingPage.tsx");

    expect(ordersPage).toContain("escapeHtml(order.customerName)");
    expect(ordersPage).toContain("escapeHtml(order.customerAddress)");
    expect(ordersPage).toContain("escapeHtml(order.note)");
    expect(ordersPage).toContain("escapeHtml(it.name)");
    expect(closingPage).toContain("escapeHtml(p.name)");
    expect(closingPage).toContain("escapeHtml(p.unit)");
  });
});
