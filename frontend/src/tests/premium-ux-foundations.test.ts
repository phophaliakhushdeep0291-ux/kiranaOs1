import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const layout = read("../components/layout/Layout.tsx");
const routeTransition = read("../components/shared/RouteTransition.tsx");
const dataTable = read("../components/shared/DataTableCard.tsx");
const textInput = read("../components/forms/TextInput.tsx");
const selectInput = read("../components/forms/SelectInput.tsx");
const form = read("../components/ui/form.tsx");
const toast = read("../components/ui/toast.tsx");
const confirmDialog = read("../components/shared/ConfirmDialog.tsx");
const taxes = read("../features/settings/pages/TaxesSettingsPage.tsx");
const billing = read("../features/billing/pages/BillingPage.tsx");
const settingsUi = read("../features/settings/ui.tsx");
const styles = read("../index.css");

describe("premium UX foundations", () => {
  it("provides skip navigation and announces completed route changes", () => {
    expect(layout).toContain('href="#main-content"');
    expect(layout).toContain('className="app-skip-link"');
    expect(layout).toContain("tabIndex={-1}");
    expect(routeTransition).toContain('role="status"');
    expect(routeTransition).toContain('aria-live="polite"');
    expect(routeTransition).toContain("page loaded");
    expect(styles).toContain(".app-skip-link:focus");
  });

  it("gives reusable form controls stable relationships and live validation", () => {
    expect(textInput).toContain("useId");
    expect(selectInput).toContain("useId");
    expect(selectInput).toContain("aria-describedby={describedBy}");
    expect(form).toContain('role="alert"');
    expect(form).toContain('aria-live="polite"');
    expect(settingsUi).toContain("labelControl(pill, label, descriptionId)");
    expect(settingsUi).toContain('role="group"');
  });

  it("makes data tables keyboard reachable and notifications dismissible", () => {
    expect(dataTable).toContain('role="region"');
    expect(dataTable).toContain("tabIndex={0}");
    expect(dataTable).toContain("tableLabel");
    expect(toast).toContain('aria-label="Dismiss notification"');
  });

  it("replaces browser-native prompts with validated product dialogs", () => {
    expect(taxes).not.toContain("window.prompt");
    expect(taxes).toContain("saveHsnEditor");
    expect(taxes).toContain("hsnInputRef.current?.focus()");
    expect(billing).not.toContain("window.confirm");
    expect(billing).toContain('title={t("billing.page.printAfterSavingTitle")}');
    expect(billing).toContain("printDecision");
  });

  it("keeps confirmation actions controlled and safe while work is pending", () => {
    expect(confirmDialog).toContain("controlsDisabled");
    expect(confirmDialog).toContain("event.preventDefault()");
    expect(confirmDialog).toContain("Please wait…");
  });
});
