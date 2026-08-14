import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const settings = read("../features/core/settings/pages/SettingsPage.tsx");
const sync = read("../features/core/settings/pages/SyncSettingsPage.tsx");
const printer = read("../features/core/settings/pages/PrinterSettingsPage.tsx");
const security = read("../features/core/settings/pages/SecuritySettingsPage.tsx");
const styles = read("../index.css");

describe("mobile settings accessibility contract", () => {
  it("makes every ADM-002 area directly reachable from the phone settings hub", () => {
    for (const href of ["/settings/billing", "/settings/taxes", "/settings/printer", "/settings/security", "/settings/sync"]) {
      expect(settings).toContain(`href: "${href}"`);
    }
    expect(settings).toContain('label: "Taxes & GST"');
  });

  it("keeps backup and sync actions at least 44px high", () => {
    expect(sync).toContain('className="inline-flex min-h-11 items-center');
    expect(sync).not.toContain('className="inline-flex h-8 items-center');
    expect(styles).toContain(".backup-create { @apply min-h-11");
    expect(styles).toContain(".settings-text-action { @apply inline-flex min-h-11 items-center");
  });

  it("keeps printer preview and queue actions touch-safe through tablet widths", () => {
    // The labels moved into the catalogue; the touch-target class is still bound to
    // the same two actions by pairing it with the key each button renders.
    expect(printer).toContain('className="settings-text-action px-2 sm:px-0">{t("settings.printer.testPrint")');
    expect(printer).toContain('className="settings-text-action px-2 sm:px-0">{t("settings.printer.clearQueue")');
    expect(printer).not.toContain("sm:min-h-0");
  });

  it("uses fitted protection cards through tablet widths instead of a scrolling table", () => {
    expect(security).toContain('className="grid gap-3 sm:grid-cols-2 lg:hidden"');
    expect(security).toContain('className="app-table-scroll hidden overflow-x-auto');
    expect(security).toContain("lg:block");
    expect(security).toContain("aria-label={`Approver for ${action.label}`}");
  });

  it("makes security refresh, navigation, sign-out, and PIN visibility controls touch-safe", () => {
    expect(security).toContain('className="settings-text-action gap-1"');
    expect(security).toContain('className="settings-text-action">{t("settings.security.refresh")');
    expect(security).toContain("flex min-h-11 items-center justify-center");
    expect(security).toContain('aria-label={show ? "Hide current PIN" : "Show current PIN"}');
    expect(security).toContain("grid h-11 w-11");
  });
});
