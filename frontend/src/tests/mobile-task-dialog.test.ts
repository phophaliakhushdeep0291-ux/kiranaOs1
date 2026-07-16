import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dialogSource = readFileSync(new URL("../components/ui/dialog.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../index.css", import.meta.url), "utf8");
const purchaseSource = readFileSync(new URL("../features/purchases/components/PurchaseOrdersPanel.tsx", import.meta.url), "utf8");
const inventorySource = readFileSync(new URL("../features/inventory/pages/InventoryPage.tsx", import.meta.url), "utf8");

describe("phone-first operational dialogs", () => {
  it("promotes only explicitly long workflows to full-screen phone tasks", () => {
    expect(dialogSource).toContain('className.includes("max-h-[90vh]")');
    expect(dialogSource).toContain('className.includes("max-h-[92vh]")');
    expect(dialogSource).toContain('data-mobile-task-dialog={isLongTask ? "true" : undefined}');
    expect(dialogSource).toContain("max-sm:h-[100dvh]");
    expect(dialogSource).toContain("max-sm:w-screen");
    expect(dialogSource).toContain("max-sm:rounded-none");
  });

  it("keeps purchase and inventory workflows opted into the long-task contract", () => {
    expect(purchaseSource).toContain('className="max-h-[92vh] max-w-3xl overflow-y-auto"');
    expect(purchaseSource).toContain('className="max-h-[92vh] max-w-2xl overflow-y-auto"');
    expect(inventorySource).toContain('className="max-w-2xl max-h-[90vh] overflow-y-auto"');
  });

  it("enforces 44px phone controls inside task dialogs", () => {
    expect(cssSource).toContain('[data-mobile-task-dialog="true"] input');
    expect(cssSource).toContain('[data-mobile-task-dialog="true"] button');
    expect(dialogSource).toContain('data-dialog-footer="true"');
    expect(cssSource).toContain('position: sticky');
    expect(cssSource).toContain('env(safe-area-inset-bottom)');
    expect(cssSource).toContain("min-height: 44px");
  });
});
