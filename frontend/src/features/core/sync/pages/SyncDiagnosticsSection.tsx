import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { hi } from "date-fns/locale";
import { AlertTriangle, CheckCircle2, RefreshCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getSyncDiagnostics, type SyncDiagnostics, type SyncFailureExplanation } from "@/features/core/sync/api";
import { readLastPullFailure, type PullFailureRecord } from "@/features/core/sync/sync-pull";
import { useAppLanguage, type AppLanguage, type Translate } from "@/features/core/settings/i18n";

// Diagnostics §3: surfaces the consolidated sync health with a plain-language
// explanation for every failure/conflict, so an owner understands *why* something
// did not back up ("Inventory update failed because the product no longer exists")
// instead of just seeing a red count.

function timeAgo(value: string | null | undefined, t: Translate, language: AppLanguage) {
  if (!value) return t("settings.sync.never");
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? formatDistanceToNow(date, { addSuffix: true, locale: language === "hi" ? hi : undefined })
    : t("settings.sync.unknown");
}

function Metric({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <span className="text-muted-foreground">
      {label}: <span className={`font-bold ${danger && value > 0 ? "text-rose-600" : "text-foreground"}`}>{value}</span>
    </span>
  );
}

function IssueRow({ item, t }: { item: SyncFailureExplanation; t: Translate }) {
  return (
    <li className="rounded-lg border bg-background p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-foreground">{item.explanation}</p>
        <Badge
          variant="outline"
          className={item.retryable ? "shrink-0 border-amber-200 bg-amber-50 text-amber-700" : "shrink-0 border-rose-200 bg-rose-50 text-rose-700"}
        >
          {item.retryable ? t("settings.sync.autoRetry") : t("settings.sync.needsAttention")}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{item.action}</p>
    </li>
  );
}

export function SyncDiagnosticsSection() {
  const { t, language } = useAppLanguage();
  const [data, setData] = useState<SyncDiagnostics | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // The server's diagnostics only describe pushes. Whether this device is still
  // RECEIVING data is something only the device knows.
  const [pullFailure, setPullFailure] = useState<PullFailureRecord | null>(null);

  function load() {
    setLoading(true);
    setFailed(false);
    void readLastPullFailure().then(setPullFailure).catch(() => setPullFailure(null));
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
          <CardTitle className="text-lg">{t("settings.sync.diagnosticsTitle")}</CardTitle>
          <CardDescription>{t("settings.sync.diagnosticsHelp")}</CardDescription>
        </div>
        <button
          type="button"
          onClick={load}
          aria-label={t("settings.sync.refreshDiagnostics")}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border text-muted-foreground transition-colors hover:bg-muted"
        >
          <RefreshCcw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
        </button>
      </CardHeader>
      <CardContent className="space-y-3">
        {loading && !data ? (
          <p className="text-sm text-muted-foreground">{t("settings.sync.checkingHealth")}</p>
        ) : failed ? (
          <p className="text-sm text-muted-foreground">{t("settings.sync.diagnosticsUnavailable")}</p>
        ) : data ? (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <Metric label={t("settings.sync.pending")} value={data.counts.pending} />
              <Metric label={t("settings.sync.failed")} value={data.counts.failed} danger />
              <Metric label={t("settings.sync.conflicts")} value={data.counts.openConflicts} danger />
              <Metric label={t("settings.sync.retries")} value={data.counts.totalRetryAttempts} />
              <span className="ml-auto text-xs text-muted-foreground">{t("settings.sync.lastSuccessful", { when: timeAgo(data.lastSuccessfulSyncAt, t, language) })}</span>
            </div>

            {pullFailure ? (
              <div className="flex items-start gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>
                  <span className="font-semibold">{t("settings.sync.deviceStoppedReceiving")}</span>{" "}
                  {t("settings.sync.deviceStoppedReceivingHelp")}
                  <span className="mt-1 block text-xs text-rose-700">
                    {t("settings.sync.lastAttempt", { when: timeAgo(pullFailure.at, t, language), reason: pullFailure.reason })}
                  </span>
                </span>
              </div>
            ) : null}

            {issues.length === 0 && !pullFailure ? (
              <div className="flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden="true" />
                {t("settings.sync.allClean")}
              </div>
            ) : issues.length === 0 ? null : (
              <ul className="space-y-2">
                {issues.map((item, index) => (
                  <IssueRow key={item.eventId ?? item.id ?? `${item.code}-${index}`} item={item} t={t} />
                ))}
              </ul>
            )}
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
