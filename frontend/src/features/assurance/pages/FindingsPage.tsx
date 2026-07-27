import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listFindings, type EntityType, type FindingStatus, type RiskLevel } from "../api";
import { AssuranceDisclaimer, Chip, EmptyState, RiskChip, ScoreBar, StatusChip, fmtDateTime, humanize, inrFromPaise } from "../ui";

const STATUSES: FindingStatus[] = [
  "OPEN", "EVIDENCE_REQUESTED", "UNDER_REVIEW", "CONFIRMED_ISSUE", "FALSE_POSITIVE", "CORRECTED", "ACCEPTED_RISK", "CLOSED",
];
const RISK_LEVELS: RiskLevel[] = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const ENTITY_TYPES: EntityType[] = ["BILL", "CUSTOMER", "PRODUCT", "PURCHASE", "EXPENSE", "DAILY_CLOSING", "SYNC_EVENT"];

export type FindingsPageProps = {
  /** Review Queue reuses this page with a preset filter and its own heading. */
  title?: string;
  description?: string;
  presetOpenOnly?: boolean;
  presetRiskLevels?: RiskLevel[];
};

export default function FindingsPage({
  title = "Findings",
  description = "Every potential inconsistency the engine has raised, newest and riskiest first.",
  presetOpenOnly = false,
  presetRiskLevels,
}: FindingsPageProps) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<FindingStatus | "">("");
  const [riskLevel, setRiskLevel] = useState<RiskLevel | "">(presetRiskLevels?.length === 1 ? presetRiskLevels[0] : "");
  const [entityType, setEntityType] = useState<EntityType | "">("");
  const [ruleCode, setRuleCode] = useState("");
  const [openOnly, setOpenOnly] = useState(presetOpenOnly);

  const query = useQuery({
    queryKey: ["assurance", "findings", { page, status, riskLevel, entityType, ruleCode, openOnly }],
    queryFn: () =>
      listFindings({
        page,
        limit: 25,
        status: status || undefined,
        riskLevel: riskLevel || undefined,
        sourceEntityType: entityType || undefined,
        ruleCode: ruleCode.trim() || undefined,
        openOnly: openOnly || undefined,
      }),
  });

  const findings = query.data?.findings ?? [];
  const pagination = query.data?.pagination;

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </header>

      <AssuranceDisclaimer />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(event) => { setStatus(event.target.value as FindingStatus | ""); setPage(1); }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {STATUSES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={riskLevel}
          onChange={(event) => { setRiskLevel(event.target.value as RiskLevel | ""); setPage(1); }}
          aria-label="Filter by risk level"
        >
          <option value="">All risk levels</option>
          {RISK_LEVELS.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={entityType}
          onChange={(event) => { setEntityType(event.target.value as EntityType | ""); setPage(1); }}
          aria-label="Filter by record type"
        >
          <option value="">All record types</option>
          {ENTITY_TYPES.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 w-56 pl-8"
            placeholder="Rule code, e.g. BILL_TOTAL_MISMATCH"
            value={ruleCode}
            onChange={(event) => { setRuleCode(event.target.value.toUpperCase()); setPage(1); }}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(event) => { setOpenOnly(event.target.checked); setPage(1); }}
          />
          Unresolved only
        </label>
        {pagination ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {pagination.total} finding{pagination.total === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {query.isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading findings…
        </div>
      ) : query.isError ? (
        <EmptyState title="Could not load findings" hint={(query.error as Error)?.message} />
      ) : findings.length === 0 ? (
        <EmptyState
          title="No findings match these filters"
          hint="Either your records are consistent for this filter, or no review has covered this period yet."
        />
      ) : (
        <ul className="space-y-2">
          {findings.map((finding) => (
            <li key={finding.findingId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/assurance/findings/${finding.findingId}`} className="text-sm font-semibold hover:underline">
                    {finding.title}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <StatusChip status={finding.status} />
                    <Chip>{humanize(finding.sourceEntityType)}</Chip>
                    {finding.primaryCategory ? <Chip>{humanize(finding.primaryCategory)}</Chip> : null}
                    {finding.reopenCount > 0 ? <Chip>Reopened ×{finding.reopenCount}</Chip> : null}
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {(finding.triggeredRules ?? []).filter((rule) => rule.active).map((rule) => (
                      <span key={rule.ruleCode} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                        {rule.ruleCode} +{rule.scoreContribution}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="w-40 shrink-0 space-y-1 text-right">
                  <RiskChip level={finding.riskLevel} score={finding.riskScore} />
                  <ScoreBar score={finding.riskScore} />
                  <p className="text-xs text-muted-foreground">{inrFromPaise(finding.amountPaise)}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtDateTime(finding.createdAt)}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pagination && pagination.totalPages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>
            <ChevronLeft className="h-4 w-4" /> Previous
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {pagination.page} of {pagination.totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pagination.totalPages}
            onClick={() => setPage((value) => value + 1)}
          >
            Next <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      ) : null}
    </div>
  );
}
