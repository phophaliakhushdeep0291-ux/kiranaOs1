import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderPlus, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import {
  createCase,
  getCase,
  listCaseProposals,
  listCases,
  summarizeCase,
  updateCaseStatus,
  type CaseProposal,
  type CaseStatus,
} from "../api";
import {
  AssuranceDisclaimer,
  Chip,
  EmptyState,
  RiskChip,
  SectionCard,
  fmtDateTime,
  humanize,
  inr,
} from "../ui";
import { useAppLanguage } from "@/features/core/settings/i18n";

export default function CasesPage() {
  const { toast } = useToast();
  const { t } = useAppLanguage();
  const queryClient = useQueryClient();
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [titles, setTitles] = useState<Record<string, string>>({});

  const proposals = useQuery({ queryKey: ["assurance", "case-proposals"], queryFn: () => listCaseProposals() });
  const cases = useQuery({ queryKey: ["assurance", "cases"], queryFn: () => listCases({ limit: 50 }) });
  const detail = useQuery({
    queryKey: ["assurance", "case", selectedCaseId],
    queryFn: () => getCase(selectedCaseId as string),
    enabled: Boolean(selectedCaseId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["assurance", "cases"] });
    queryClient.invalidateQueries({ queryKey: ["assurance", "case-proposals"] });
    if (selectedCaseId) queryClient.invalidateQueries({ queryKey: ["assurance", "case", selectedCaseId] });
  };

  const createMutation = useMutation({
    mutationFn: (proposal: CaseProposal) =>
      createCase({ title: titles[proposal.key]?.trim() || proposal.label, findingIds: proposal.findingIds }),
    onSuccess: (created) => {
      toast({ title: t("assurance.cases.opened") });
      setSelectedCaseId(created.caseId);
      invalidate();
    },
    onError: (error: Error) => toast({ title: t("assurance.cases.openFailed"), description: error.message, variant: "destructive" }),
  });

  const summaryMutation = useMutation({
    mutationFn: (caseId: string) => summarizeCase(caseId),
    onSuccess: (result) => {
      toast({
        title: result.degraded ? "Summary generated locally" : "Summary generated",
        description: result.recommendedNextStep,
      });
      invalidate();
    },
    onError: (error: Error) => toast({ title: t("assurance.detail.explain"), description: error.message, variant: "destructive" }),
  });

  const statusMutation = useMutation({
    mutationFn: (input: { caseId: string; status: CaseStatus }) => updateCaseStatus(input.caseId, { status: input.status }),
    onSuccess: (updated) => {
      toast({ title: `Case ${humanize(updated.status).toLowerCase()}` });
      invalidate();
    },
    onError: (error: Error) => toast({ title: t("assurance.cases.updateFailed"), description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">{t("assurance.cases.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Related findings grouped into one story — by customer, supplier, staff member, business day, or a rule that keeps
          repeating.
        </p>
      </header>

      <AssuranceDisclaimer />

      <SectionCard
        title={t("assurance.cases.suggested")}
        description={t("assurance.cases.suggestedHint")}
      >
        {proposals.isLoading ? (
          <div className="flex h-24 items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Looking for patterns…
          </div>
        ) : !proposals.data?.groups.length ? (
          <EmptyState
            title={t("assurance.cases.noneSuggested")}
            hint={t("assurance.cases.noneSuggestedHint", { count: proposals.data?.findingsConsidered ?? 0 })}
          />
        ) : (
          <ul className="space-y-2">
            {proposals.data.groups.map((proposal) => (
              <li key={proposal.key} className="rounded-lg border border-border p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{proposal.label}</p>
                      <Chip>{humanize(proposal.strategy)}</Chip>
                      <RiskChip level={proposal.riskLevel} score={proposal.maxRiskScore} />
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {proposal.findingCount} finding(s) · {inr(proposal.totalAmountRupees)} under review
                    </p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {proposal.ruleCodes.slice(0, 6).map((ruleCode) => (
                        <span key={ruleCode} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {ruleCode}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex w-full items-center gap-2 sm:w-auto">
                    <Input
                      className="h-9 w-full sm:w-56"
                      placeholder={proposal.label}
                      value={titles[proposal.key] ?? ""}
                      onChange={(event) => setTitles((current) => ({ ...current, [proposal.key]: event.target.value }))}
                      aria-label={t("assurance.cases.detail")}
                    />
                    <Button
                      size="sm"
                      onClick={() => createMutation.mutate(proposal)}
                      disabled={createMutation.isPending}
                    >
                      <FolderPlus className="mr-1 h-3.5 w-3.5" /> Open case
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title={t("assurance.cases.open")} description={t("assurance.cases.openHint")}>
          {cases.isLoading ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !cases.data?.cases.length ? (
            <EmptyState title={t("assurance.cases.none")} hint={t("assurance.cases.noneHint")} />
          ) : (
            <ul className="divide-y divide-border">
              {cases.data.cases.map((row) => (
                <li key={row.caseId}>
                  <button
                    type="button"
                    onClick={() => setSelectedCaseId(row.caseId)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left ${
                      selectedCaseId === row.caseId ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{row.title}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {row.findingCount} finding(s) · {fmtDateTime(row.createdAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <RiskChip level={row.riskLevel} />
                      <Chip>{humanize(row.status)}</Chip>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title={t("assurance.cases.detail")}
          description={selectedCaseId ? t("assurance.cases.detailHint") : t("assurance.select")}
          actions={
            selectedCaseId ? (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => summaryMutation.mutate(selectedCaseId)}
                  disabled={summaryMutation.isPending}
                >
                  {summaryMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                  Summarize
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => statusMutation.mutate({ caseId: selectedCaseId, status: "CLOSED" })}
                  disabled={statusMutation.isPending}
                >
                  Close
                </Button>
              </div>
            ) : null
          }
        >
          {!selectedCaseId ? (
            <EmptyState title={t("assurance.select")} />
          ) : detail.isLoading ? (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !detail.data ? (
            <EmptyState title={t("assurance.notFound")} />
          ) : (
            <div className="space-y-3">
              <div>
                <h3 className="text-sm font-semibold">{detail.data.title}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {detail.data.findingCount} finding(s) · {inr(detail.data.totalAmountRupees ?? 0)} under review ·{" "}
                  {humanize(detail.data.status)}
                </p>
              </div>
              {detail.data.summary ? (
                <p className="rounded-md bg-muted/40 p-2 text-xs leading-relaxed">{detail.data.summary}</p>
              ) : null}
              <ul className="divide-y divide-border">
                {detail.data.findings.map((finding) => (
                  <li key={finding.findingId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <div className="min-w-0">
                      <Link href={`/assurance/findings/${finding.findingId}`} className="text-xs font-medium hover:underline">
                        {finding.title}
                      </Link>
                      <p className="font-mono text-[10px] text-muted-foreground">{finding.ruleCodes.join(", ")}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Chip>{humanize(finding.status)}</Chip>
                      <RiskChip level={finding.riskLevel} score={finding.riskScore} />
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-muted-foreground">
                Closing a case does not close its findings — each one still needs its own resolution.
              </p>
            </div>
          )}
        </SectionCard>
      </div>
    </div>
  );
}
