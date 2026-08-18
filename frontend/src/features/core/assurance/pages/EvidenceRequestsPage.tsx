import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { listEvidenceRequests, type EvidenceStatus } from "../api";
import {
  AssuranceDisclaimer,
  EvidenceChip,
  EmptyState,
  RiskChip,
  fmtDateTime,
  humanize,
  useAssuranceWords,
} from "../ui";

const STATUS_FILTERS: EvidenceStatus[] = ["REQUESTED", "PROVIDED", "VERIFIED", "REJECTED", "INSUFFICIENT", "NOT_APPLICABLE"];

export default function EvidenceRequestsPage() {
  const { t } = useAppLanguage();
  const words = useAssuranceWords();
  const [status, setStatus] = useState<EvidenceStatus | "">("");
  const query = useQuery({
    queryKey: ["assurance", "evidence-requests", status],
    queryFn: () => listEvidenceRequests({ status: status || undefined, limit: 50 }),
  });

  const requests = query.data?.requests ?? [];

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">{t("assurance.proofPage.title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t("assurance.proofPage.subtitle")}</p>
      </header>

      <AssuranceDisclaimer />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value as EvidenceStatus | "")}
          aria-label={t("assurance.proofPage.title")}
        >
          <option value="">{t("assurance.proofPage.filterOutstanding")}</option>
          {STATUS_FILTERS.map((value) => <option key={value} value={value}>{words.proof(value)}</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{query.data?.pagination.total ?? 0}</span>
      </div>

      {query.isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> {t("assurance.running")}
        </div>
      ) : requests.length === 0 ? (
        <EmptyState title={t("assurance.proofPage.empty")} hint={t("assurance.proofPage.emptyHint")} />
      ) : (
        <ul className="space-y-2">
          {requests.map((request) => (
            <li key={request.requirementId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  {/* Evidence TYPES are a long open list the catalogue does not
                      cover yet, so they stay on humanize() rather than render
                      as a raw key. */}
                  <p className="text-sm font-semibold">{humanize(request.evidenceType)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{request.description}</p>
                  {request.finding ? (
                    <Link href={`/assurance/findings/${request.finding.findingId}`} className="mt-1 block text-xs font-medium text-primary hover:underline">
                      {request.finding.title}
                    </Link>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t("assurance.proofPage.askedOn", { when: fmtDateTime(request.createdAt) })}
                  </p>
                  {request.submittedEvidence.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {request.submittedEvidence.map((evidence) => (
                        <EvidenceChip key={evidence.evidenceId} status={evidence.verificationStatus} />
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <EvidenceChip status={request.status} />
                  {request.finding ? <RiskChip level={request.finding.riskLevel} /> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
