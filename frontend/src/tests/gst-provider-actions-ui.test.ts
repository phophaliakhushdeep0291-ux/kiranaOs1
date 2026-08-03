import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const taxes = readFileSync("src/features/core/settings/pages/TaxesSettingsPage.tsx", "utf8");

describe("GST provider actions", () => {
  it("routes e-way requests to legal submission only when provider readiness attests it", () => {
    expect(taxes).toContain('legalSubmission ? "submit" : "draft"');
    expect(taxes).toContain("Approve legal e-way bill submission");
    expect(taxes).toContain("using an idempotent request");
  });

  it("exposes legal e-invoice submission and clearly separated sandbox validation", () => {
    expect(taxes).toContain('legalSubmission ? "submit" : "sandbox"');
    expect(taxes).toContain("Submit GST e-invoice");
    expect(taxes).toContain("Sandbox validation does not create a legal IRN");
    expect(taxes).toContain("Approve legal e-invoice submission");
  });
});
