import { useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, FileText, Loader2, MessageSquare, Send, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  addReview,
  explainFinding,
  getFinding,
  requestEvidence,
  submitEvidence,
  updateFindingStatus,
  verifyEvidence,
  type EvidenceStatus,
  type FindingStatus,
} from "../api";
import {
  AssuranceDisclaimer,
  Chip,
  DetailGrid,
  EVIDENCE_TONE,
  EmptyState,
  RiskChip,
  ScoreBar,
  SectionCard,
  StatusChip,
  fmtDateTime,
  humanize,
  inrFromPaise,
} from "../ui";

const EVIDENCE_TYPES = [
  "SALES_INVOICE", "PURCHASE_INVOICE", "PAYMENT_RECEIPT", "UPI_REFERENCE", "BANK_TRANSACTION",
  "SUPPLIER_INVOICE_NUMBER", "GOODS_RECEIPT_CONFIRMATION", "CUSTOMER_CONFIRMATION", "STOCK_COUNT_CONFIRMATION",
  "EXPENSE_RECEIPT", "STAFF_EXPLANATION", "OWNER_APPROVAL", "CANCELLATION_REASON", "CORRECTION_REASON",
  "DEVICE_TIMESTAMP_METADATA",
];

const RESOLUTIONS: { status: FindingStatus; label: string; hint: string }[] = [
  { status: "UNDER_REVIEW", label: "Start review", hint: "You are looking into this" },
  { status: "CONFIRMED_ISSUE", label: "Confirm issue", hint: "This is a real problem" },
  { status: "CORRECTED", label: "Mark corrected", hint: "Fixed through the normal screens" },
  { status: "FALSE_POSITIVE", label: "False positive", hint: "The records are actually fine" },
  { status: "ACCEPTED_RISK", label: "Accept risk", hint: "Known and accepted as-is" },
  { status: "CLOSED", label: "Close", hint: "No further action needed" },
];

export default function FindingDetailPage() {
  const { id = "" } = useParams<{ id: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [comment, setComment] = useState("");
  const [evidenceType, setEvidenceType] = useState(EVIDENCE_TYPES[0]);
  const [evidenceValue, setEvidenceValue] = useState("");
  const [requestType, setRequestType] = useState(EVIDENCE_TYPES[0]);
  const [requestNote, setRequestNote] = useState("");
  const [reviewNotes, setReviewNotes] = useState("");
  const [language, setLanguage] = useState<"en" | "hi" | "hinglish">("en");

  const query = useQuery({ queryKey: ["assurance", "finding", id], queryFn: () => getFinding(id), enabled: Boolean(id) });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["assurance", "finding", id] });
    queryClient.invalidateQueries({ queryKey: ["assurance", "findings"] });
    queryClient.invalidateQueries({ queryKey: ["assurance", "dashboard"] });
  };

  const statusMutation = useMutation({
    mutationFn: (status: FindingStatus) => updateFindingStatus(id, { status, comment: comment.trim() || undefined }),
    onSuccess: (finding) => {
      toast({ title: `Finding marked ${humanize(finding.status)}` });
      setComment("");
      invalidate();
    },
    onError: (error: Error) => toast({ title: "Could not change status", description: error.message, variant: "destructive" }),
  });

  const evidenceMutation = useMutation({
    mutationFn: () => submitEvidence(id, { evidenceType, referenceValue: evidenceValue.trim(), referenceKind: "reference" }),
    onSuccess: (evidence) => {
      toast({
        title: "Evidence recorded",
        description: evidence.reuseWarningCount
          ? `Note: this reference is already attached to ${evidence.reuseWarningCount} other finding(s).`
          : "A reviewer still needs to verify it.",
      });
      setEvidenceValue("");
      invalidate();
    },
    onError: (error: Error) => toast({ title: "Could not save evidence", description: error.message, variant: "destructive" }),
  });

  const requestMutation = useMutation({
    mutationFn: () => requestEvidence(id, { evidenceType: requestType, description: requestNote.trim() || `Please provide ${humanize(requestType)}` }),
    onSuccess: () => {
      toast({ title: "Evidence requested" });
      setRequestNote("");
      invalidate();
    },
    onError: (error: Error) => toast({ title: "Could not request evidence", description: error.message, variant: "destructive" }),
  });

  const verifyMutation = useMutation({
    mutationFn: (input: { evidenceId: string; verificationStatus: EvidenceStatus }) =>
      verifyEvidence(input.evidenceId, { verificationStatus: input.verificationStatus }),
    onSuccess: (evidence) => {
      toast({ title: `Evidence ${humanize(evidence.verificationStatus).toLowerCase()}` });
      invalidate();
    },
    onError: (error: Error) => toast({ title: "Could not update evidence", description: error.message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: (decision: string) => addReview(id, { decision, notes: reviewNotes.trim() || undefined }),
    onSuccess: () => {
      toast({ title: "Review note added" });
      setReviewNotes("");
      invalidate();
    },
    onError: (error: Error) => toast({ title: "Could not add review", description: error.message, variant: "destructive" }),
  });

  const explainMutation = useMutation({
    mutationFn: () => explainFinding(id, { language }),
    onSuccess: (result) => {
      toast({
        title: result.degraded ? "Explanation generated locally" : "Explanation generated",
        description: result.degraded ? "The AI provider is unavailable, so the deterministic summary is shown." : undefined,
      });
      invalidate();
    },
    onError: (error: Error) => toast({ title: "Could not generate explanation", description: error.message, variant: "destructive" }),
  });

  if (query.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center text-muted-foreground">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading finding…
      </div>
    );
  }
  if (query.isError || !query.data) {
    return (
      <div className="p-4">
        <EmptyState title="Finding not found" hint="It may belong to another shop, or the id is wrong." />
      </div>
    );
  }

  const finding = query.data;
  const breakdown = finding.scoreBreakdown;
  const activeRules = (finding.triggeredRules ?? []).filter((rule) => rule.active);
  const inactiveRules = (finding.triggeredRules ?? []).filter((rule) => !rule.active);

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center gap-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/assurance/findings"><ArrowLeft className="mr-1 h-4 w-4" /> Findings</Link>
        </Button>
      </div>

      <header className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-lg font-semibold">{finding.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <StatusChip status={finding.status} />
              <Chip>{humanize(finding.sourceEntityType)}</Chip>
              {finding.primaryCategory ? <Chip>{humanize(finding.primaryCategory)}</Chip> : null}
              <Chip>Confidence {Math.round(finding.confidence * 100)}%</Chip>
              {finding.reopenCount > 0 ? <Chip>Reopened ×{finding.reopenCount}</Chip> : null}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Raised {fmtDateTime(finding.createdAt)} · amount under review {inrFromPaise(finding.amountPaise)} · engine{" "}
              <span className="font-mono">{finding.engineVersion}</span> · rule set <span className="font-mono">{finding.rulesetVersion}</span>
            </p>
          </div>
          <div className="w-48 space-y-2">
            <div className="text-right">
              <RiskChip level={finding.riskLevel} score={finding.riskScore} />
            </div>
            <ScoreBar score={finding.riskScore} />
            <p className="text-right text-xs text-muted-foreground">{finding.riskScore} / 100</p>
          </div>
        </div>
        <AssuranceDisclaimer className="mt-3" />
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <SectionCard title="Why this was flagged" description="Each rule below is a deterministic check with its own numbers">
            {activeRules.length === 0 ? (
              <EmptyState title="No rules currently triggering" hint="The condition may have been corrected since." />
            ) : (
              <ul className="space-y-3">
                {activeRules.map((rule) => (
                  <li key={rule.ruleCode} className="rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{rule.name}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">
                          {rule.ruleCode} · v{rule.ruleVersion} · {humanize(rule.category)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <RiskChip level={rule.severity} />
                        <Chip>+{rule.scoreContribution} pts</Chip>
                      </div>
                    </div>
                    {rule.description ? <p className="mt-2 text-xs text-muted-foreground">{rule.description}</p> : null}
                    <div className="mt-2 rounded-md bg-muted/40 p-2">
                      <DetailGrid details={rule.details} />
                    </div>
                    {rule.remediation ? (
                      <p className="mt-2 text-xs">
                        <span className="font-semibold">What to do: </span>
                        {rule.remediation}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {inactiveRules.length ? (
              <p className="mt-3 text-xs text-muted-foreground">
                {inactiveRules.length} rule(s) triggered earlier but no longer apply; they are kept on the record:{" "}
                {inactiveRules.map((rule) => rule.ruleCode).join(", ")}.
              </p>
            ) : null}
          </SectionCard>

          <SectionCard
            title="How the score was calculated"
            description="Fully reproducible — no model output is involved in this number"
          >
            <p className="mb-3 rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed">{breakdown.formula}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-border text-left text-muted-foreground">
                    <th className="py-1 pr-2 font-medium">Rule</th>
                    <th className="py-1 pr-2 font-medium">Severity</th>
                    <th className="py-1 pr-2 text-right font-medium">Weight</th>
                    <th className="py-1 pr-2 text-right font-medium">× Severity</th>
                    <th className="py-1 pr-2 text-right font-medium">Raw</th>
                    <th className="py-1 text-right font-medium">Contribution</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdown.triggeredRules.map((rule) => (
                    <tr key={rule.ruleCode} className="border-b border-border/60">
                      <td className="py-1 pr-2 font-mono text-[10px]">{rule.ruleCode}</td>
                      <td className="py-1 pr-2">{rule.severity}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">
                        {rule.weight}
                        {rule.weightSource === "shop_override" ? <span className="ml-1 text-muted-foreground">(custom)</span> : null}
                      </td>
                      <td className="py-1 pr-2 text-right tabular-nums">×{rule.severityMultiplier}</td>
                      <td className="py-1 pr-2 text-right tabular-nums">{rule.rawContribution}</td>
                      <td className="py-1 text-right font-semibold tabular-nums">
                        {rule.scoreContribution}
                        {rule.cappedAt ? <span className="ml-1 text-[10px] text-muted-foreground">(capped)</span> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3 space-y-1 text-xs">
              <BreakdownRow label="Base score (sum of contributions)" value={`${breakdown.baseScore}${breakdown.summedContributions > 100 ? " (clamped from " + breakdown.summedContributions + ")" : ""}`} />
              <BreakdownRow label={`Materiality (${breakdown.materialityBand})`} value={`× ${breakdown.materialityMultiplier}`} />
              <BreakdownRow label={`History (${breakdown.historyLabel})`} value={`× ${breakdown.historyMultiplier}`} />
              {breakdown.scoreFloorApplied ? (
                <BreakdownRow
                  label={`Minimum for ${breakdown.scoreFloorRuleCode}`}
                  value={`floor ${breakdown.scoreFloor} applied (was ${breakdown.modifiedScore})`}
                />
              ) : null}
              <BreakdownRow label="Final risk score" value={`${breakdown.finalScore} → ${breakdown.riskLevel}`} strong />
              <BreakdownRow label="Confidence" value={String(breakdown.confidence)} />
            </dl>
            <ul className="mt-2 list-inside list-disc text-[11px] text-muted-foreground">
              {breakdown.confidenceReasons.map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
            <p className="mt-2 break-all font-mono text-[10px] text-muted-foreground">input hash: {breakdown.inputHash}</p>
          </SectionCard>

          <SectionCard title="Source transaction" description="Read-only view of the record this finding is about">
            <DetailGrid details={sanitizeSource(finding.sourceTransaction)} />
            <p className="mt-2 text-[11px] text-muted-foreground">
              The assurance module never edits this record. Corrections must be made through the normal KiranaOS screens so
              they leave their own trail.
            </p>
          </SectionCard>

          <SectionCard
            title="Plain-language explanation"
            description="Rephrases the deterministic result — it never changes any number"
            actions={
              <div className="flex items-center gap-2">
                <select
                  className="h-8 rounded-md border border-input bg-background px-2 text-xs"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as typeof language)}
                  aria-label="Explanation language"
                >
                  <option value="en">English</option>
                  <option value="hi">हिन्दी</option>
                  <option value="hinglish">Hinglish</option>
                </select>
                <Button size="sm" variant="outline" onClick={() => explainMutation.mutate()} disabled={explainMutation.isPending}>
                  {explainMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
                  Explain
                </Button>
              </div>
            }
          >
            {finding.aiExplanation ? (
              <p className="whitespace-pre-line text-sm">{finding.aiExplanation}</p>
            ) : (
              <EmptyState title="No explanation generated yet" hint="Use Explain to produce an owner-friendly summary." />
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title="Resolution" description="Every change is recorded permanently">
            <div className="space-y-2">
              <Label htmlFor="resolution-comment" className="text-xs">Comment (recommended)</Label>
              <Input
                id="resolution-comment"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="What did you find?"
              />
              <div className="grid gap-1.5 pt-1">
                {RESOLUTIONS.map((option) => (
                  <Button
                    key={option.status}
                    variant="outline"
                    size="sm"
                    className="justify-between"
                    disabled={statusMutation.isPending || finding.status === option.status}
                    onClick={() => statusMutation.mutate(option.status)}
                  >
                    <span>{option.label}</span>
                    <span className="text-[10px] font-normal text-muted-foreground">{option.hint}</span>
                  </Button>
                ))}
              </div>
              <p className="pt-1 text-[11px] text-muted-foreground">
                Findings are never deleted. Statuses your role cannot set are rejected by the server.
              </p>
            </div>
          </SectionCard>

          <SectionCard title="Evidence requested" description="Raised automatically by the triggered rules">
            {finding.evidenceRequirements.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing outstanding.</p>
            ) : (
              <ul className="space-y-2">
                {finding.evidenceRequirements.map((requirement) => (
                  <li key={requirement.requirementId} className="rounded-md border border-border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">{humanize(requirement.evidenceType)}</p>
                        <p className="text-[11px] text-muted-foreground">{requirement.description}</p>
                      </div>
                      <Chip tone={EVIDENCE_TONE[requirement.status]}>{humanize(requirement.status)}</Chip>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <Label className="text-xs">Request more evidence</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={requestType}
                onChange={(event) => setRequestType(event.target.value)}
              >
                {EVIDENCE_TYPES.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
              </select>
              <Input value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="What exactly is needed?" />
              <Button size="sm" variant="outline" className="w-full" onClick={() => requestMutation.mutate()} disabled={requestMutation.isPending}>
                {requestMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <MessageSquare className="mr-1 h-3.5 w-3.5" />}
                Request
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Evidence provided" description="Submitted documents and references are never auto-verified">
            {finding.evidence.length === 0 ? (
              <p className="text-xs text-muted-foreground">No evidence submitted yet.</p>
            ) : (
              <ul className="space-y-2">
                {finding.evidence.map((evidence) => (
                  <li key={evidence.evidenceId} className="rounded-md border border-border p-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">{humanize(evidence.evidenceType)}</p>
                        <p className="break-words text-[11px] text-muted-foreground">{evidence.referenceValue}</p>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">{fmtDateTime(evidence.createdAt)}</p>
                        {Number(evidence.extractedMetadata?.reuseCount ?? 0) > 0 ? (
                          <p className="mt-1 text-[11px] font-medium text-[#d97706]">
                            Also attached to {String(evidence.extractedMetadata.reuseCount)} other finding(s)
                          </p>
                        ) : null}
                      </div>
                      <Chip tone={EVIDENCE_TONE[evidence.verificationStatus]}>{humanize(evidence.verificationStatus)}</Chip>
                    </div>
                    {evidence.verificationStatus === "PROVIDED" ? (
                      <div className="mt-2 flex gap-1.5">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 text-xs"
                          disabled={verifyMutation.isPending}
                          onClick={() => verifyMutation.mutate({ evidenceId: evidence.evidenceId, verificationStatus: "VERIFIED" })}
                        >
                          <Check className="mr-1 h-3 w-3" /> Verify
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 text-xs"
                          disabled={verifyMutation.isPending}
                          onClick={() => verifyMutation.mutate({ evidenceId: evidence.evidenceId, verificationStatus: "INSUFFICIENT" })}
                        >
                          Not enough
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 flex-1 text-xs"
                          disabled={verifyMutation.isPending}
                          onClick={() => verifyMutation.mutate({ evidenceId: evidence.evidenceId, verificationStatus: "REJECTED" })}
                        >
                          <X className="mr-1 h-3 w-3" /> Reject
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 space-y-2 border-t border-border pt-3">
              <Label className="text-xs">Submit evidence</Label>
              <select
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={evidenceType}
                onChange={(event) => setEvidenceType(event.target.value)}
              >
                {EVIDENCE_TYPES.map((type) => <option key={type} value={type}>{humanize(type)}</option>)}
              </select>
              <Input
                value={evidenceValue}
                onChange={(event) => setEvidenceValue(event.target.value)}
                placeholder="Invoice no., UPI ref, or a written explanation"
              />
              <Button
                size="sm"
                className="w-full"
                onClick={() => evidenceMutation.mutate()}
                disabled={evidenceMutation.isPending || !evidenceValue.trim()}
              >
                {evidenceMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                Submit
              </Button>
            </div>
          </SectionCard>

          <SectionCard title="Reviewer notes">
            {finding.reviews.length ? (
              <ul className="mb-3 space-y-2">
                {finding.reviews.map((review) => (
                  <li key={review.reviewId} className="rounded-md border border-border p-2">
                    <div className="flex items-center justify-between gap-2">
                      <Chip>{humanize(review.decision)}</Chip>
                      <span className="text-[10px] text-muted-foreground">{fmtDateTime(review.createdAt)}</span>
                    </div>
                    {review.notes ? <p className="mt-1 text-xs">{review.notes}</p> : null}
                    <p className="mt-0.5 text-[10px] text-muted-foreground">{humanize(review.reviewerRole)}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            <Input value={reviewNotes} onChange={(event) => setReviewNotes(event.target.value)} placeholder="Add a review note" />
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {["CONFIRMED_ISSUE", "FALSE_POSITIVE", "NEEDS_MORE_EVIDENCE", "CORRECTED"].map((decision) => (
                <Button
                  key={decision}
                  size="sm"
                  variant="outline"
                  className="h-7 text-[11px]"
                  disabled={reviewMutation.isPending}
                  onClick={() => reviewMutation.mutate(decision)}
                >
                  {humanize(decision)}
                </Button>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Timeline" description="Append-only history of this finding">
            <ol className="space-y-2">
              {finding.timeline.map((entry) => (
                <li key={entry.historyId} className="border-l-2 border-border pl-3">
                  <p className="text-xs font-medium">
                    {entry.previousStatus && entry.previousStatus !== entry.newStatus
                      ? `${humanize(entry.previousStatus)} → ${humanize(entry.newStatus)}`
                      : humanize(entry.newStatus)}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {fmtDateTime(entry.createdAt)} · {humanize(entry.changedByRole)}
                  </p>
                  {entry.comment ? <p className="mt-0.5 text-[11px] text-muted-foreground">{entry.comment}</p> : null}
                </li>
              ))}
            </ol>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function BreakdownRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={strong ? "font-semibold tabular-nums" : "tabular-nums"}>{value}</dd>
    </div>
  );
}

// Drop noisy nested collections from the read-only source view; the finding's own
// rule details already carry the specific numbers that matter.
function sanitizeSource(source: Record<string, unknown>) {
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source ?? {})) {
    if (key === "items" || key === "payments") {
      output[key] = Array.isArray(value) ? `${value.length} row(s)` : value;
      continue;
    }
    output[key] = value;
  }
  return output;
}
