import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { it } from "vitest";
import { findHardcodedStrings } from "../i18n-hardcoded-strings";
it("lists", () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const target = "features/core/dashboard/pages/DashboardPage.tsx";
  const hits = findHardcodedStrings(readFileSync(root + target, "utf8"));
  writeFileSync("C:/Users/phoph/AppData/Local/Temp/claude/C--Users-phoph-Desktop-app/cd717dc5-bbb8-4991-97b3-99020bc65bd6/scratchpad/dashboard-strings.txt", hits.map((h) => `${h.line}\t${h.kind}\t${h.text}`).join("\n"), "utf8");
});
