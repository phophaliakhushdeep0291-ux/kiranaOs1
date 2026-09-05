import { useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useOfflineStatus } from "@/features/core/sync/useOfflineStatus";
import { runManualSyncCycle } from "@/features/core/sync/manual-sync";

/**
 * What the top of the app says about work that has not reached the cloud yet.
 *
 * A silent "pending" bill is worse than a visible "syncing" one — the shopkeeper
 * needs to know the bill is not backed up. But the banner used to have only two
 * faces, and anything pending wore the warning triangle.
 *
 * That is wrong for the case that produces the most pending rows by far. Loading
 * the built-in starter catalogue queues one outbox row per product — several
 * hundred at once — and a shop watching that drain was shown an amber alert
 * counting down, indistinguishable from a real backup failure, at the exact
 * moment nothing was wrong. The first thing a new shop does with the product
 * list looked like a fault.
 *
 * So there are three states, not two:
 *
 *   review     something failed or conflicted and a person must look at it
 *   backing up rows are queued and the engine is actively sending them
 *   waiting    rows are queued and nothing is moving right now (offline, paused)
 *
 * Only the first two existed before, and everything that was not failing got the
 * third one's wording with the first one's colour.
 */
export type SyncBannerMode = "review" | "backingUp" | "waiting";

/**
 * Which face the banner wears, as a rule rather than a nested ternary.
 *
 * null means say nothing at all: an empty queue is not news.
 *
 * Review outranks progress on purpose. A batch can be moving while an earlier
 * row sits failed, and the failure is the thing that needs saying — showing a
 * calm spinner over it is how a stuck row goes unnoticed for a day.
 */
export function syncBannerMode(counts: {
  pendingCount: number;
  failedCount: number;
  conflictCount: number;
  isSyncing: boolean;
}): SyncBannerMode | null {
  const needsReview = counts.failedCount + counts.conflictCount;
  if (counts.pendingCount + needsReview === 0) return null;
  if (needsReview > 0) return "review";
  return counts.isSyncing ? "backingUp" : "waiting";
}

export function SyncAlertBanner() {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  // The engine already keeps these counts and publishes them; reading them here
  // replaces a second IndexedDB poll that ran every eight seconds on its own
  // timer, and is what makes isSyncing — the whole point of this change —
  // visible to the banner at all.
  const { pendingCount, failedCount, conflictCount, isSyncing } = useOfflineStatus();
  const [retrying, setRetrying] = useState(false);

  const needsReview = failedCount + conflictCount;
  // A manual retry is the shop asking for exactly this, so treat it as sending.
  const mode = syncBannerMode({ pendingCount, failedCount, conflictCount, isSyncing: isSyncing || retrying });
  if (!mode) return null;

  // "1 changes need review" is what a shop reads most of the time now that a
  // single refusal is counted once, and Hindi distinguishes the two forms too
  // ("देखना है" against "देखने हैं"). Both dictionaries carry a .one variant.
  const headlineCount = mode === "review" ? needsReview : pendingCount;
  const headlineKey = mode === "review"
    ? "sync.banner.reviewTitle"
    : mode === "backingUp"
      ? "sync.banner.backingUpTitle"
      : "sync.banner.waitingTitle";
  const headline = t(headlineCount === 1 ? `${headlineKey}.one` : headlineKey, { count: headlineCount });

  const sub = mode === "review"
    ? t("sync.banner.reviewBody")
    : mode === "backingUp"
      ? t("sync.banner.backingUpBody")
      : t("sync.banner.waitingBody");

  const tone = mode === "review"
    ? "border-rose-300 bg-rose-50 text-rose-900 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-200"
    : mode === "backingUp"
      ? "border-sky-300 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200"
      : "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200";

  const onRetry = async () => {
    setRetrying(true);
    try {
      await runManualSyncCycle();
    } catch {
      toast({
        title: t("sync.banner.retryFailedTitle"),
        description: t("sync.banner.retryFailedBody"),
        variant: "destructive",
      });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className={`flex items-center gap-3 border-b px-3 py-2 ${tone}`} data-testid="sync-alert-banner" data-mode={mode}>
      {mode === "backingUp"
        ? <Loader2 size={16} className="shrink-0 animate-spin" aria-hidden="true" />
        : <AlertTriangle size={16} className="shrink-0" aria-hidden="true" />}
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-bold leading-tight">{headline}</div>
        <div className="text-[11px] leading-tight opacity-80">{sub}</div>
      </div>
      {/* Nothing to retry while the queue is already moving — offering it there
          invites a second cycle that the engine would only serialise anyway. */}
      {mode === "backingUp" ? null : (
        <button
          type="button"
          onClick={() => void onRetry()}
          disabled={retrying}
          className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border border-current/30 bg-white/70 px-3 text-[12px] font-bold disabled:opacity-50 dark:bg-black/20"
        >
          <RefreshCw size={13} className={retrying ? "animate-spin" : ""} aria-hidden="true" />
          {retrying ? t("sync.banner.retrying") : t("sync.banner.retry")}
        </button>
      )}
      <Link href="/sync-status" className="inline-flex h-11 shrink-0 items-center rounded-lg px-2 text-[12px] font-bold underline-offset-2 hover:underline">
        {t("sync.banner.view")}
      </Link>
    </div>
  );
}
