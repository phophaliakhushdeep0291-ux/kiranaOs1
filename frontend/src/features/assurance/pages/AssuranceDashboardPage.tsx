import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, FileSearch, Loader2, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getAssuranceDashboard, recomputeBaselines, startRun } from "../api";
import {
  AssuranceDisclaimer,
  Chip,
  EmptyState,
  RiskChip,
  SectionCard,
  StatCard,
  StatusChip,
  fmtDateTime,
  humanize,
  inr,
} from "../ui";

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export default function AssuranceDashboardPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [rangeDays, setRangeDays] = useState(7);

  const dashboard = useQuery({
    queryKey: ["assurance", "dashboard"],
    queryFn: getAssuranceDashboard,
  });

  const runMutation = useMutation({
    mutationFn: () => startRun({ runType: "MANUAL", from: isoDaysAgo(rangeDays), to: new Date().toISOString() }),
    onSuccess: (result) => {
      toast({
        title: "Assurance run finished",
        description: `${result.evaluated} transaction(s) reviewed · ${result.findingsCreated} new finding(s) · ${result.findingsUpdated} updated.`,
      });
      queryClient.invalidateQueries({ queryKey: ["assurance"] });
    },
    onError: (error: Error) => toast({ title: "Run failed", description: error.message, variant: "destructive" }),
  });

  const baselineMutation = useMutation({
    mutationFn: recomputeBaselines,
    onSuccess: (result) =>
      toast({ title: "Baselines recomputed", description: `${result.baselineCount} shop baseline(s) refreshed from your own history.` }),
    onError: (error: Error) => toast({ title: "Baseline refresh failed", description: error.message, variant: "destructive" }),
  });

  const data = dashboard.data;

  const categoryChart = useMemo(
    () =>
      Object.entries(data?.byCategory ?? {})
        .map(([category, count]) => ({ category: humanize(category), count }))
        .sort((left, right) => right.count - left.count),
    [data?.byCategory]
  );

  if (dashboard.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading assurance dashboard…
      </div>
    );
  }

  if (dashboard.isError) {
    return (
      <div className="p-4">
        <EmptyState title="Could not load the assurance dashboard" hint={(dashboard.error as Error)?.message} />
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <ShieldCheck className="h-5 w-5 text-primary" /> Financial Assurance
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Continuous control monitoring across billing, khata, stock, purchases, expenses, cash and sync.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 rounded-md border border-input bg-background px-2 text-sm"
            value={rangeDays}
            onChange={(event) => setRangeDays(Number(event.target.value))}
            aria-label="Review period"
          >
            <option value={1}>Last 24 hours</option>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
            {runMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Run review
          </Button>
          <Button variant="outline" onClick={() => baselineMutation.mutate()} disabled={baselineMutation.isPending}>
            {baselineMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
            Refresh baselines
          </Button>
        </div>
      </header>

      <AssuranceDisclaimer />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard label="Open findings" value={data?.totals.openFindings ?? 0} hint="Awaiting review or evidence" />
        <StatCard
          label="Critical"
          value={data?.totals.criticalFindings ?? 0}
          hint="Needs attention first"
          tone={(data?.totals.criticalFindings ?? 0) > 0 ? "text-[#ef4444]" : undefined}
        />
        <StatCard label="High risk" value={data?.totals.highFindings ?? 0} hint="Serious but not critical" />
        <StatCard
          label="Amount under review"
          value={inr(data?.totals.highRiskAmountRupees ?? 0)}
          hint="Recorded value of high/critical items — not a loss figure"
        />
        <StatCard label="Evidence pending" value={data?.totals.unresolvedEvidenceRequests ?? 0} hint="Documents still requested" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Findings over time" description="New findings raised per day (last 30 days)">
          {data?.trend?.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.trend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(value: string) => value.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="total" name="All" stroke="var(--brand)" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="critical" name="Critical" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="high" name="High" stroke="#d97706" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="No findings yet" hint="Run a review to check your recent transactions." />
          )}
        </SectionCard>

        <SectionCard title="Findings by area" description="Open findings grouped by control category">
          {categoryChart.length ? (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={categoryChart} layout="vertical" margin={{ left: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="category" tick={{ fontSize: 11 }} width={120} />
                  <Tooltip />
                  <Bar dataKey="count" name="Findings" fill="var(--brand)" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <EmptyState title="Nothing open" hint="No open findings in any category." />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <SectionCard
          title="Highest-risk findings"
          description="Sorted by risk score"
          className="lg:col-span-2"
          actions={
            <Button asChild variant="outline" size="sm">
              <Link href="/assurance/findings">View all</Link>
            </Button>
          }
        >
          {data?.topFindings?.length ? (
            <ul className="divide-y divide-border">
              {data.topFindings.map((finding) => (
                <li key={finding.findingId} className="flex flex-wrap items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <Link href={`/assurance/findings/${finding.findingId}`} className="text-sm font-medium hover:underline">
                      {finding.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <StatusChip status={finding.status} />
                      <Chip>{humanize(finding.sourceEntityType)}</Chip>
                      {finding.triggeredRules?.slice(0, 2).map((rule) => (
                        <Chip key={rule.ruleCode}>{rule.ruleCode}</Chip>
                      ))}
                    </div>
                  </div>
                  <RiskChip level={finding.riskLevel} score={finding.riskScore} />
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No open findings" hint="Your recent transactions look internally consistent." />
          )}
        </SectionCard>

        <SectionCard title="Latest review run" description="Most recent evaluation of your books">
          {data?.latestRun ? (
            <dl className="space-y-2 text-sm">
              <Row label="Type" value={humanize(data.latestRun.runType)} />
              <Row label="Status" value={<Chip>{humanize(data.latestRun.status)}</Chip>} />
              <Row label="Reviewed" value={`${data.latestRun.entitiesEvaluated} transaction(s)`} />
              <Row label="New findings" value={String(data.latestRun.findingsCreated)} />
              <Row label="Finished" value={fmtDateTime(data.latestRun.completedAt)} />
              <Row label="Engine" value={<span className="font-mono text-[11px]">{data.latestRun.engineVersion}</span>} />
              <Row label="Rule set" value={<span className="font-mono text-[11px]">{data.latestRun.rulesetVersion}</span>} />
              <div className="pt-2">
                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link href="/assurance/runs">All runs</Link>
                </Button>
              </div>
            </dl>
          ) : (
            <EmptyState title="No runs yet" hint="Use “Run review” to evaluate your recent transactions." />
          )}
        </SectionCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Top risk areas" description="Rules triggering most often in your shop">
          {data?.topRiskAreas?.length ? (
            <ul className="space-y-2">
              {data.topRiskAreas.map((area) => (
                <li key={area.ruleCode} className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{area.name}</p>
                    <p className="font-mono text-[11px] text-muted-foreground">{area.ruleCode}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {area.severity ? <RiskChip level={area.severity} /> : null}
                    <span className="text-sm font-semibold tabular-nums">{area.findingCount}</span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="Nothing triggering" />
          )}
        </SectionCard>

        <SectionCard
          title="Who and what is affected"
          description="Derived from the source transactions of open findings — for follow-up, not blame"
        >
          <div className="space-y-4">
            <AffectedList
              heading="Staff"
              rows={(data?.affected.staff ?? []).map((row) => ({ id: row.userId, label: `${row.name} (${row.role})`, count: row.findingCount }))}
            />
            <AffectedList
              heading="Customers"
              rows={(data?.affected.customers ?? []).map((row) => ({
                id: row.customerId,
                label: `${row.name} · outstanding ${inr(row.outstandingRupees)}`,
                count: row.findingCount,
              }))}
            />
            <AffectedList
              heading="Suppliers"
              rows={(data?.affected.suppliers ?? []).map((row, index) => ({
                id: row.supplierId ?? `supplier-${index}`,
                label: row.name ?? "Unnamed supplier",
                count: row.findingCount,
              }))}
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Engine status" description="The deterministic engine runs regardless of AI availability">
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <span className="flex items-center gap-1.5">
            <FileSearch className="h-4 w-4 text-muted-foreground" />
            Engine <span className="font-mono text-[11px]">{data?.engineVersion}</span>
          </span>
          <span className="flex items-center gap-1.5">
            Rule set <span className="font-mono text-[11px]">{data?.rulesetVersion}</span>
          </span>
          <span className="flex items-center gap-1.5">
            AI explanations: <Chip>{data?.aiStatus.provider ?? "disabled"}</Chip>
            {data?.aiStatus.provider === "disabled" ? (
              <span className="text-xs text-muted-foreground">plain-language summaries are generated locally</span>
            ) : null}
          </span>
        </div>
        {(data?.totals.criticalFindings ?? 0) > 0 ? (
          <p className="mt-3 flex items-start gap-2 rounded-md bg-[#fdebeb] p-3 text-xs text-[#ef4444]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {data?.totals.criticalFindings} critical finding(s) are open. Review these first — they are the ones most likely to
            mean real money or a data problem.
          </p>
        ) : null}
      </SectionCard>
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium">{value}</dd>
    </div>
  );
}

function AffectedList({ heading, rows }: { heading: string; rows: Array<{ id: string; label: string; count: number }> }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{heading}</h3>
      {rows.length ? (
        <ul className="mt-1 space-y-1">
          {rows.slice(0, 5).map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{row.label}</span>
              <span className="tabular-nums text-muted-foreground">{row.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-muted-foreground">None affected.</p>
      )}
    </div>
  );
}
