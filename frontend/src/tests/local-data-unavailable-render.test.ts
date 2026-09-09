import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { syncEn } from "@/features/core/settings/translations/sync";
vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ t: (key: keyof typeof syncEn) => syncEn[key] }) }));
import { LocalDataUnavailable } from "@/features/core/sync/LocalDataUnavailable";

describe("local read failure recovery surface", () => {
  it("renders a visible alert with retry and recovery, not zero totals or a synced label", () => {
    const html = renderToStaticMarkup(createElement(LocalDataUnavailable, { onRetry: () => undefined }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Cannot verify local data");
    expect(html).toContain("Retry local check");
    expect(html).toContain('href="/recovery-mode"');
    expect(html).not.toContain("Synced");
    expect(html).not.toContain("₹0");
  });
  it("does not announce healthy or recovery failure before the initial check completes", () => {
    const html = renderToStaticMarkup(createElement(LocalDataUnavailable, { checking: true, onRetry: () => undefined }));
    expect(html).toContain('role="status"');
    expect(html).toContain("Checking local data");
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Cannot verify local data");
  });
});
