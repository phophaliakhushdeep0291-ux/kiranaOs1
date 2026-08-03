import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { getRun, listRuns, startRun } from "../api";
import { AssuranceDisclaimer, Chip, EmptyState, SectionCard, fmtDateTime, humanize } from "../ui";

function defaultFrom() {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export default function AuditRunsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [from, setFrom] = useState(defaultFrom());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const runs = useQuery({ queryKey: ["assurance", "runs"], queryFn: () => listRuns({ limit: 25 }) });
  const runDetail = useQuery({
    queryKey: ["assurance", "run", selectedRunId],
    queryFn: () => getRun(selectedRunId as string),
    enabled: Boolean(selectedRunId),
  });

  const startMutation = useMutation({
    mutationFn: () =>
      startRun({
        runType: "MANUAL",
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: new Date(`${to}T23:59:59`).toISOString(),
      }),
    onSuccess: (result) => {
      toast({
        title: "Review complete",
        description: `${result.evaluated} transaction(s) reviewed · ${result.findingsCreated} new · ${result.findingsUpdated} updated.`,
      });
      queryClient.invalidateQueries({ queryKey: ["assurance"] });
      setSelectedRunId(result.runId);
    },
    onError: (error: Error) => toast({ title: "Run failed", description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">Audit Runs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every evaluation of your records — automatic after each transaction, scheduled, or started by you.
        </p>
      </header>

      <AssuranceDisclaimer />

      <SectionCard title="Start a review" description="Evaluates all transactions recorded in the chosen period">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="run-from" className="text-xs">From</Label>
            <Input id="run-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="h-9 w-40" />
          </div>
          <div>
            <Label htmlFor="run-to" className="text-xs">To</Label>
            <Input id="run-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="h-9 w-40" />
          </div>
          <Button onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
            {startMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Play className="mr-2 h-4 w-4" />}
            Run review
          </Button>
          <p className="text-xs text-muted-foreground">
            Re-running a period is safe: evaluations are idempotent and will not create duplicate findings.
          </p>
        </div>
      </SectionCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <SectionCard title="Recent runs">
          {runs.isLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : (runs.data?.runs.length ?? 0) === 0 ? (
            <EmptyState title="No runs yet" hint="Start a review above." />
          ) : (
            <ul className="divide-y divide-border">
              {runs.data?.runs.map((run) => (
                <li key={run.runId}>
                  <button
                    type="button"
                    onClick={() => setSelectedRunId(run.runId)}
                    className={`flex w-full flex-wrap items-center justify-between gap-2 py-2 text-left ${
                      selectedRunId === run.runId ? "bg-muted/40" : ""
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{humanize(run.runType)}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {fmtDateTime(run.startedAt)} · {run.entitiesEvaluated} reviewed · {run.findingsCreated} new
                      </p>
                    </div>
                    <Chip>{humanize(run.status)}</Chip>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Run detail" description={selectedRunId ? "Per-transaction evaluations from this run" : "Select a run to inspect it"}>
          {!selectedRunId ? (
            <EmptyState title="No run selected" />
          ) : runDetail.isLoading ? (
            <div className="flex h-32 items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : runDetail.data ? (
            <div className="space-y-3">
              <dl className="grid gap-1 text-xs sm:grid-cols-2">
                <Row label="Status" value={humanize(runDetail.data.status)} />
                <Row label="Reviewed" value={String(runDetail.data.entitiesEvaluated)} />
                <Row label="Findings created" value={String(runDetail.data.findingsCreated)} />
                <Row label="Findings updated" value={String(runDetail.data.findingsUpdated)} />
                <Row label="Engine" value={runDetail.data.engineVersion} mono />
                <Row label="Rule set" value={runDetail.data.rulesetVersion} mono />
                <Row label="Started" value={fmtDateTime(runDetail.data.startedAt)} />
                <Row label="Finished" value={fmtDateTime(runDetail.data.completedAt)} />
              </dl>

              {runDetail.data.summary.findingsByRiskLevel ? (
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(runDetail.data.summary.findingsByRiskLevel).map(([level, count]) => (
                    <Chip key={level}>{level}: {count}</Chip>
                  ))}
                </div>
              ) : null}

              {(runDetail.data.summary.failureCount ?? 0) > 0 ? (
                <div className="rounded-md bg-[#fdf3e1] p-2 text-[11px] text-[#d97706]">
                  {runDetail.data.summary.failureCount} transaction(s) could not be evaluated. The run continued; the
                  next scheduled review will retry them.
                </div>
              ) : null}

              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-card">
                    <tr className="border-b border-border text-left text-muted-foreground">
                      <th className="py-1 pr-2 font-medium">Record</th>
                      <th className="py-1 pr-2 text-right font-medium">Score</th>
                      <th className="py-1 font-medium">Rules</th>
                    </tr>
                  </thead>
                  <tbody>
                    {runDetail.data.evaluations.map((evaluation) => (
                      <tr key={evaluation.evaluationId} className="border-b border-border/60">
                        <td className="py-1 pr-2">{humanize(evaluation.sourceEntityType)}</td>
                        <td className="py-1 pr-2 text-right font-semibold tabular-nums">{evaluation.riskScore}</td>
                        <td className="py-1 font-mono text-[10px]">
                          {evaluation.triggeredRuleCodes.length ? evaluation.triggeredRuleCodes.join(", ") : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <EmptyState title="Run not found" />
          )}
        </SectionCard>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-[10px]" : "font-medium"}>{value}</dd>
    </div>
  );
}
