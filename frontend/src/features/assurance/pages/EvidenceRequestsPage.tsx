import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { listEvidenceRequests, type EvidenceStatus } from "../api";
import { AssuranceDisclaimer, Chip, EVIDENCE_TONE, EmptyState, RiskChip, fmtDateTime, humanize } from "../ui";

const STATUS_FILTERS: EvidenceStatus[] = ["REQUESTED", "PROVIDED", "VERIFIED", "REJECTED", "INSUFFICIENT", "NOT_APPLICABLE"];

export default function EvidenceRequestsPage() {
  const [status, setStatus] = useState<EvidenceStatus | "">("");
  const query = useQuery({
    queryKey: ["assurance", "evidence-requests", status],
    queryFn: () => listEvidenceRequests({ status: status || undefined, limit: 50 }),
  });

  const requests = query.data?.requests ?? [];

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">Evidence Requests</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Documents and confirmations the engine asked for. A submitted file is never treated as valid until a reviewer verifies it.
        </p>
      </header>

      <AssuranceDisclaimer />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={status}
          onChange={(event) => setStatus(event.target.value as EvidenceStatus | "")}
          aria-label="Filter by evidence status"
        >
          <option value="">Outstanding (requested, provided, insufficient)</option>
          {STATUS_FILTERS.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">{query.data?.pagination.total ?? 0} request(s)</span>
      </div>

      {query.isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading evidence requests…
        </div>
      ) : requests.length === 0 ? (
        <EmptyState title="No evidence outstanding" hint="Nothing is waiting on a document right now." />
      ) : (
        <ul className="space-y-2">
          {requests.map((request) => (
            <li key={request.requirementId} className="rounded-xl border border-border bg-card p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{humanize(request.evidenceType)}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{request.description}</p>
                  {request.finding ? (
                    <Link to={`/assurance/findings/${request.finding.findingId}`} className="mt-1 block text-xs font-medium text-primary hover:underline">
                      {request.finding.title}
                    </Link>
                  ) : null}
                  <p className="mt-1 text-[11px] text-muted-foreground">Requested {fmtDateTime(request.createdAt)}</p>
                  {request.submittedEvidence.length ? (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {request.submittedEvidence.map((evidence) => (
                        <Chip key={evidence.evidenceId} tone={EVIDENCE_TONE[evidence.verificationStatus]}>
                          {humanize(evidence.verificationStatus)}
                        </Chip>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Chip tone={EVIDENCE_TONE[request.status]}>{humanize(request.status)}</Chip>
                  {request.finding ? <RiskChip level={request.finding.riskLevel} score={request.finding.riskScore} /> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
