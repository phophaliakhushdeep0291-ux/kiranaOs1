import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";
import { assuranceEn } from "@/features/core/settings/translations/assurance";
import { assuranceHi } from "@/features/core/settings/translations/assurance.hi";

const state = vi.hoisted(() => ({
  language: "en", toast: vi.fn(), report: null as unknown,
  onSuccess: null as null | ((result: { status: string; runId: string; evaluated: number; findingsCreated: number }) => void),
}));
vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({
  t: (key: string, vars: Record<string, string | number> = {}) => {
    const catalogue: Record<string, string> = state.language === "hi" ? assuranceHi : assuranceEn;
    return (catalogue[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) => String(vars[name] ?? match));
  },
}) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@tanstack/react-query", () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({ data: queryKey[1] === "report" ? state.report : { runs: [] }, isLoading: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: (options: { onSuccess: typeof state.onSuccess }) => {
    state.onSuccess = options.onSuccess;
    return { isPending: false, mutate: vi.fn() };
  },
}));
import AuditRunsPage from "@/features/core/assurance/pages/AuditRunsPage";
import AssuranceReportPage from "@/features/core/assurance/pages/AssuranceReportPage";

beforeEach(() => { state.language = "en"; state.toast.mockClear(); });

it.each(["FAILED", "PARTIAL"])("a %s API response warns instead of celebrating a completed review", status => {
  renderToStaticMarkup(createElement(AuditRunsPage));
  state.onSuccess!({ status, runId: "run-1", evaluated: 0, findingsCreated: 0 });
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: "Check incomplete", variant: "destructive", description: expect.stringContaining("retry"),
  }));
});

it("a completed review still reports the checked records and findings", () => {
  renderToStaticMarkup(createElement(AuditRunsPage));
  state.onSuccess!({ status: "COMPLETED", runId: "run-1", evaluated: 12, findingsCreated: 2 });
  expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({
    title: assuranceEn["assurance.runDone"], variant: "default",
    description: expect.stringContaining("12"),
  }));
});

it.each(["en", "hi"])("the printable report exposes incomplete coverage in %s", language => {
  state.language = language;
  const coverage = { incompleteRuns: 2, transactionsReviewed: 3, auditRuns: 4 };
  state.report = {
    period: { from: "2026-09-01", to: "2026-09-26" }, generatedAt: "2026-09-26",
    engineVersion: "test", rulesetVersion: "test", coverage,
    findings: { raised: 0, resolved: 0, openCritical: 0, topRules: [] },
    exposure: { highRiskAmountRupees: 0, quantifiedFindings: 0, unquantifiedFindings: 0 },
    byArea: {}, evidence: { byStatus: {}, note: "" },
    managementResponses: { byDecision: {}, byResolutionType: {} }, openCriticalFindings: [], limitations: [],
  };
  const html = renderToStaticMarkup(createElement(AssuranceReportPage));
  expect(html).toContain('role="status"');
  expect(html).toContain(language === "hi" ? "अधूरी या विफल" : "2 unfinished or failed runs");
  coverage.incompleteRuns = 0;
  expect(renderToStaticMarkup(createElement(AssuranceReportPage))).not.toContain('role="status"');
});
