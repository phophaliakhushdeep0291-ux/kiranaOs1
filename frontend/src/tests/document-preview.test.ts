import { describe, expect, it } from "vitest";
import { documentPreview } from "@/features/core/settings/document-preview";

describe("stored document preview", () => {
  it("keeps legitimate offline PDF and image previews", () => {
    expect(documentPreview({ type: "application/pdf", dataUrl: "data:application/pdf;base64,JVBERg==" }))
      .toEqual({ tag: "iframe", url: "data:application/pdf;base64,JVBERg==" });
    expect(documentPreview({ type: "image/png", dataUrl: "data:image/png;base64,iVBORw==" })?.tag).toBe("img");
  });
  it("rejects stored script URLs, HTML, mismatched MIME types and attribute injection", () => {
    for (const dataUrl of [
      "javascript:alert(1)", "https://attacker.invalid/document", "//attacker.invalid",
      'x\" onload=\"alert(1)', "data:text/html;base64,PHNjcmlwdD4=",
      "data:application/pdf;base64,JVBERg==\" onload=\"alert(1)",
      "data:application/pdf,hello", "data:application/pdf;base64,",
    ]) expect(documentPreview({ type: "application/pdf", dataUrl }), dataUrl).toBeNull();
    expect(documentPreview({ type: "text/html", dataUrl: "data:text/html;base64,PHNjcmlwdD4=" })).toBeNull();
  });
});
