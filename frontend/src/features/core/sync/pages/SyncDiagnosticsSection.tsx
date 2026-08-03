import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { CheckCircle2, RefreshCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSyncDiagnostics, type SyncDiagnostics, type SyncFailureExplanation } from "@/features/core/sync/api";

// Diagnostics §3: surfaces the consolidated sync health with a plain-language
// explanation for every failure/conflict, so an owner understands *why* something
// did not back up ("Inventory update failed because the product no longer exists")
// instead of just seeing a red count.

function timeAgo(value?: string | null) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatDistanceToNow(date, { addSuffix: true }) : "unknown";
}

function Metric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <span className="text-muted-foreground">
      {label}: <span className={`font-bold ${danger && value > 0 ? "text-rose-600" : "text-foreground"}`}>{value}</span>
    </span>
  );
}

function IssueRow({ item }: { item: SyncFailureExplanation }) {
  return (
    <li className="rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{item.explanation}</p>
        <Badge
          variant="outline"
          className={item.retryable ? "shrink-0 border-amber-200 bg-amber-50 text-amber-700" : "shrink-0 border-rose-200 bg-rose-50 text-rose-700"}
        >
          {item.retryable ? "Auto-retry" : "Needs attention"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{item.action}</p>
    </li>
  );
}

export function SyncDiagnosticsSection() {
  const [data, setData] = useState<SyncDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  function load() {
    setLoading(true);
    setFailed(false);
    getSyncDiagnostics({ background: true })
      .then((result) => setData(result))
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  const issues = data ? [...data.recentFailures, ...data.recentConflicts] : [];

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-lg">Sync diagnostics</CardTitle>
          <CardDescription>Plain-language explanations for anything that could not back up.</CardDescription>
        </div>
        <button
          type="button"
          onClick={load}
          aria-label="Refresh sync diagnostics"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted"
        >
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && !data ? (
          <p className="text-sm text-muted-foreground">Checking sync health…</p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">Could not load sync diagnostics right now. Try again in a moment.</p>
        ) : data ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <Metric label="Pending" value={data.counts.pending} />
              <Metric label="Failed" value={data.counts.failed} danger />
              <Metric label="Conflicts" value={data.counts.openConflicts} danger />
              <Metric label="Retries" value={data.counts.totalRetryAttempts} />
              <span className="ml-auto text-xs text-muted-foreground">Last successful sync {timeAgo(data.lastSuccessfulSyncAt)}</span>
            </div>

            {issues.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                Everything is syncing cleanly — no failures or conflicts.
              </div>
            ) : (
              <ul className="space-y-2">
                {issues.map((item, index) => (
                  <IssueRow key={item.eventId ?? item.id ?? `${item.code}-${index}`} item={item} />
                ))}
              </ul>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
