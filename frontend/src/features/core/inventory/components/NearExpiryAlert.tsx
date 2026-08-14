import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, CalendarClock, IndianRupee } from "lucide-react";
import { cn } from "@/lib/utils";
import { getExpiryAlerts, type ExpiringBatch, type ExpirySeverity } from "@/features/core/inventory/inventory-lots-api";
import { useAppLanguage } from "@/features/core/settings/i18n";

export const NEAR_EXPIRY_QUERY_KEY = ["inventory-lots", "expiry-alerts"] as const;

const TONE: Record<ExpirySeverity, { chip: string; label: string }> = {
  expired: { chip: "bg-rose-50 text-rose-700", label: "Expired" },
  critical: { chip: "bg-amber-50 text-amber-700", label: "Expiring soon" },
  warning: { chip: "bg-blue-50 text-blue-700", label: "Watch" },
};

const rupees = (value: number) => `₹${Math.round(value).toLocaleString("en-IN")}`;

/** "Expired 3d ago" / "Expires today" / "12d left" — the phrasing a shelf check needs. */
export function expiryPhrase(days: number) {
  if (days < 0) return `Expired ${Math.abs(days)}d ago`;
  if (days === 0) return "Expires today";
  return `${days}d left`;
}

export function ExpiringBatchRow({ batch }: { batch: ExpiringBatch }) {
  const tone = TONE[batch.severity];
  return (
    <li className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="truncate text-xs font-bold text-[var(--brand-ink)]">{batch.product.name}</p>
        <p className="font-mono text-[10px] text-[#64748b]">
          {batch.batchNumber} · {batch.location.name}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold", tone.chip)}>
          {expiryPhrase(batch.daysUntilExpiry)}
        </span>
        <span className="w-16 text-right text-xs font-black tabular-nums text-[var(--brand-ink)]">
          {rupees(batch.valueAtRisk)}
        </span>
      </div>
    </li>
  );
}

/**
 * Stock that is about to become a write-off, and what it would cost.
 *
 * Expiry is the one inventory loss a shop can see coming and still do something
 * about — discount it, return it to the supplier, stop reordering it. The batch
 * ledger always held the dates; nothing added them up, so the loss only became
 * visible once it had already happened.
 *
 * Renders nothing at all when there is nothing at risk. A permanent zero-state
 * card on the dashboard is noise, and noise is what makes real alerts invisible.
 */
export function NearExpiryAlert({ limit = 5, className }: { limit?: number; className?: string }) {
  const { t } = useAppLanguage();
  const query = useQuery({
    queryKey: NEAR_EXPIRY_QUERY_KEY,
    queryFn: () => getExpiryAlerts(),
    staleTime: 5 * 60_000,
    // Batch tracking is off for most trades, and the endpoint is capability-gated;
    // a shop without it should see no error, just nothing.
    retry: false,
  });

  const data = query.data;
  if (!data || data.totalCount === 0) return null;

  const { expired, critical, warning } = data.buckets;

  return (
    <section className={cn("rounded-2xl border bg-white p-4 shadow-sm", className)} aria-label={t("inventory.nearExpiry.title")}>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700">
            <CalendarClock size={17} aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-black text-[var(--brand-ink)]">{t("inventory.nearExpiry.title")}</p>
            <p className="text-[11px] text-[#64748b]">
              {data.totalCount} {data.totalCount === 1 ? "batch" : "batches"} within {data.thresholds.warningDays} days
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="flex items-center justify-end gap-0.5 text-lg font-black tabular-nums text-[var(--brand-ink)]">
            <IndianRupee size={14} aria-hidden="true" />
            {Math.round(data.totalValueAtRisk).toLocaleString("en-IN")}
          </p>
          <p className="text-[10px] font-semibold text-[#64748b]">{t("inventory.nearExpiry.atRisk")}</p>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-2">
        {expired.count > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-1 text-[10px] font-bold text-rose-700">
            <AlertTriangle size={11} aria-hidden="true" />
            {expired.count} expired · {rupees(expired.valueAtRisk)}
          </span>
        ) : null}
        {critical.count > 0 ? (
          <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-700">
            {critical.count} within {data.thresholds.criticalDays}d · {rupees(critical.valueAtRisk)}
          </span>
        ) : null}
        {warning.count > 0 ? (
          <span className="rounded-full bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">
            {warning.count} within {data.thresholds.warningDays}d · {rupees(warning.valueAtRisk)}
          </span>
        ) : null}
      </div>

      <ul className="mb-1">
        {data.batches.slice(0, limit).map((batch) => <ExpiringBatchRow key={batch.id} batch={batch} />)}
      </ul>

      {data.batches.length > limit ? (
        <Link href="/inventory/batches" className="text-[11px] font-bold text-[var(--brand)] hover:underline">
          View all {data.totalCount} batches →
        </Link>
      ) : null}
    </section>
  );
}
