import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { FileText, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getAssuranceReport } from "../api";
import { Chip, EmptyState, RiskChip, SectionCard, StatCard, fmtDate, fmtDateTime, humanize, inr } from "../ui";
import { useAppLanguage } from "@/features/core/settings/i18n";

function isoDate(daysAgo = 0) {
  return new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function AssuranceReportPage() {
  const { t } = useAppLanguage();
  const [from, setFrom] = useState(isoDate(30));
  const [to, setTo] = useState(isoDate(0));
  const [range, setRange] = useState({ from: isoDate(30), to: isoDate(0) });

  const query = useQuery({
    queryKey: ["assurance", "report", range],
    queryFn: () =>
      getAssuranceReport({
        from: new Date(`${range.from}T00:00:00`).toISOString(),
        to: new Date(`${range.to}T23:59:59`).toISOString(),
      }),
  });

  const report = query.data;

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <FileText className="h-5 w-5 text-primary" /> Financial Assurance Report
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Continuous Control Report — <strong>{t("assurance.notStatutory")}</strong> and not an audit opinion.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <div>
            <Label htmlFor="report-from" className="text-xs">{t("assurance.from")}</Label>
            <Input id="report-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 w-36" />
          </div>
          <div>
            <Label htmlFor="report-to" className="text-xs">{t("assurance.to")}</Label>
            <Input id="report-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 w-36" />
          </div>
          <Button variant="outline" onClick={() => setRange({ from, to })}>{t("assurance.report.generate")}</Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-2 h-4 w-4" /> Print
          </Button>
        </div>
      </header>

      {query.isLoading ? (
        <div className="flex h-64 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Building report…
        </div>
      ) : !report ? (
        <EmptyState title={t("assurance.report.failed")} hint={(query.error as Error)?.message} />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Period {fmtDate(report.period.from)} – {fmtDate(report.period.to)} · generated {fmtDateTime(report.generatedAt)} ·
            engine <span className="font-mono">{report.engineVersion}</span> · {t("assurance.ruleSet")} <span className="font-mono">{report.rulesetVersion}</span>
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t("assurance.report.reviewed")} value={report.coverage.transactionsReviewed} hint={`${report.coverage.auditRuns} run(s)`} />
            <StatCard label={t("assurance.report.raised")} value={report.findings.raised} hint={t("assurance.report.resolvedIn", { count: report.findings.resolved })} />
            <StatCard
              label={t("assurance.report.criticalOpen")}
              value={report.findings.openCritical}
              tone={report.findings.openCritical > 0 ? "text-[#ef4444]" : undefined}
            />
            <StatCard
              label={t("assurance.stat.toCheck")}
              value={inr(report.exposure.highRiskAmountRupees)}
              hint={`${report.exposure.quantifiedFindings} measured${report.exposure.unquantifiedFindings > 0 ? ` · ${report.exposure.unquantifiedFindings} not quantified` : ""}`}
            />
          </div>

          <SectionCard title={t("assurance.report.areas")} description={t("assurance.report.areasHint")}>
            <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
              {Object.entries(report.byArea).map(([area, count]) => (
                <div key={area} className="flex items-baseline justify-between gap-2 border-b border-dashed border-border/60 py-1">
                  <dt className="text-xs text-muted-foreground">{humanize(area)}</dt>
                  <dd className="text-sm font-semibold tabular-nums">{count}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>

          <div className="grid gap-4 lg:grid-cols-2">
            <SectionCard title={t("assurance.report.frequent")} description={t("assurance.report.frequentHint")}>
              {report.findings.topRules.length ? (
                <ul className="space-y-2">
                  {report.findings.topRules.map((rule) => (
                    <li key={rule.ruleCode} className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm">{rule.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{rule.ruleCode}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        {rule.severity ? <RiskChip level={rule.severity} /> : null}
                        <span className="text-sm font-semibold tabular-nums">{rule.findingCount}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={t("assurance.report.noneInPeriod")} />
              )}
            </SectionCard>

            <SectionCard title={t("assurance.report.response")} description={t("assurance.report.responseHint")}>
              <div className="space-y-3">
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("assurance.proofPage.title")}</h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(report.evidence.byStatus).map(([status, count]) => (
                      <Chip key={status}>{humanize(status)}: {count}</Chip>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{report.evidence.note}</p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("assurance.detail.notes")}</h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(report.managementResponses.byDecision).length ? (
                      Object.entries(report.managementResponses.byDecision).map(([decision, count]) => (
                        <Chip key={decision}>{humanize(decision)}: {count}</Chip>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("assurance.report.noReviews")}</span>
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t("assurance.detail.decide")}</h3>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {Object.entries(report.managementResponses.byResolutionType).length ? (
                      Object.entries(report.managementResponses.byResolutionType).map(([type, count]) => (
                        <Chip key={type}>{humanize(type)}: {count}</Chip>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("assurance.report.noResolutions")}</span>
                    )}
                  </div>
                </div>
              </div>
            </SectionCard>
          </div>

          <SectionCard title={t("assurance.report.criticalOpen")} description={t("assurance.report.criticalOpenHint")}>
            {report.openCriticalFindings.length ? (
              <ul className="divide-y divide-border">
                {report.openCriticalFindings.map((finding) => (
                  <li key={finding.findingId} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link href={`/assurance/findings/${finding.findingId}`} className="text-sm font-medium hover:underline">
                        {finding.title}
                      </Link>
                      <p className="font-mono text-[10px] text-muted-foreground">{finding.ruleCodes.join(", ")}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-muted-foreground">{finding.amountRupees === null ? "—" : inr(finding.amountRupees)}</span>
                      <RiskChip level={finding.riskLevel} score={finding.riskScore} />
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title={t("assurance.report.criticalNone")} />
            )}
          </SectionCard>

          <SectionCard title={t("assurance.report.limits")} description={t("assurance.report.limitsHint")}>
            <ol className="list-inside list-decimal space-y-1.5 text-xs text-muted-foreground">
              {report.limitations.map((limitation) => (
                <li key={limitation}>{limitation}</li>
              ))}
            </ol>
          </SectionCard>
        </>
      )}
    </div>
  );
}
