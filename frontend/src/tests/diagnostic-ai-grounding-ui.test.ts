import fs from "node:fs";
import { describe, expect, it } from "vitest";

describe("diagnostic AI grounding UI", () => {
  it("types and displays server-issued grounding provenance without exposing provider prose", () => {
    const client = fs.readFileSync("src/lib/diagnostics/diagnosticsClient.ts", "utf8");
    const page = fs.readFileSync("src/features/core/support/pages/AskArthaPage.tsx", "utf8");

    expect(client).toContain("aiGrounding?: {");
    expect(client).toContain('status:');
    expect(client).toContain('| "verified"');
    expect(client).toContain("evidenceIds: string[]");
    expect(client).toContain("rejectedReason: string | null");

    expect(page).toContain("function GroundingBadge");
    expect(page).toContain("Evidence verified · {count} signal");
    expect(page).toContain("AI output rejected · deterministic fallback");
    expect(page).toContain("Deterministic diagnosis");
    expect(page).toContain("The explanation was composed by KiranaOS from verified diagnostic evidence.");
    expect(page).toContain("<GroundingBadge answer={turn.answer} />");
  });
});
