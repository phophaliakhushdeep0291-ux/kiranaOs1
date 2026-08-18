import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listFindings, updateFindingStatus, type EntityType, type Finding, type FindingStatus, type RiskLevel } from "../api";
import { AssuranceDisclaimer, EmptyState, useAssuranceWords } from "../ui";
import { ProblemCard } from "../ProblemCard";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useToast } from "@/hooks/use-toast";

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
  title,
  description,
  presetOpenOnly = false,
  presetRiskLevels,
}: FindingsPageProps) {
  const { t } = useAppLanguage();
  const words = useAssuranceWords();
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
        <h1 className="text-xl font-semibold">{title ?? t("assurance.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{description ?? t("assurance.subtitle")}</p>
      </header>

      <AssuranceDisclaimer />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(event) => { setStatus(event.target.value as FindingStatus | ""); setPage(1); }}
          aria-label={t("assurance.filter.status")}
        >
          <option value="">{t("assurance.filter.allStatuses")}</option>
          {STATUSES.map((value) => <option key={value} value={value}>{words.status(value)}</option>)}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={riskLevel}
          onChange={(event) => { setRiskLevel(event.target.value as RiskLevel | ""); setPage(1); }}
          aria-label={t("assurance.filter.risk")}
        >
          <option value="">{t("assurance.filter.allRisk")}</option>
          {RISK_LEVELS.map((value) => <option key={value} value={value}>{words.risk(value)}</option>)}
        </select>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={entityType}
          onChange={(event) => { setEntityType(event.target.value as EntityType | ""); setPage(1); }}
          aria-label={t("assurance.filter.type")}
        >
          <option value="">{t("assurance.filter.allTypes")}</option>
          {ENTITY_TYPES.map((value) => <option key={value} value={value}>{words.entity(value)}</option>)}
        </select>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-9 w-56 pl-8"
            placeholder={t("assurance.filter.ruleCode")}
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
          {t("assurance.status.OPEN")}
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
        <EmptyState title={t("assurance.loadFailed")} hint={(query.error as Error)?.message} />
      ) : findings.length === 0 ? (
        <EmptyState title={t("assurance.empty.title")} hint={t("assurance.empty.hint")} />
      ) : (
        <ul className="space-y-2">
          {findings.map((finding) => (
            <li key={finding.findingId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <ProblemCard finding={finding} />
                <DecideButtons finding={finding} />
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

/**
 * The two decisions an owner actually makes about a flagged row.
 *
 * Both are real transitions the engine already allows out of OPEN — this is not
 * a shortcut around the review workflow, it is the same PATCH the detail screen
 * sends, minus the vocabulary. A row whose status has moved on shows nothing
 * here: re-deciding belongs on the detail screen where the history is visible.
 */
function DecideButtons({ finding }: { finding: Finding }) {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const decide = useMutation({
    mutationFn: (status: FindingStatus) => updateFindingStatus(finding.findingId, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["assurance"] }),
    onError: (error: Error) => toast({ title: error.message, variant: "destructive" }),
  });

  if (finding.status !== "OPEN") return null;

  return (
    <div className="flex shrink-0 gap-2">
      <Button
        variant="outline"
        size="sm"
        disabled={decide.isPending}
        onClick={() => decide.mutate("FALSE_POSITIVE")}
      >
        {t("assurance.action.fine")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={decide.isPending}
        onClick={() => decide.mutate("CONFIRMED_ISSUE")}
      >
        {t("assurance.action.problem")}
      </Button>
    </div>
  );
}
