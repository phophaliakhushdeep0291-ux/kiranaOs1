import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { listSellableBatches, type SellableBatch } from "@/features/core/inventory/inventory-lots-api";

const DAY = 86_400_000;

function daysLeft(expiresOn: string) {
  return Math.ceil((new Date(expiresOn).getTime() - Date.now()) / DAY);
}

/**
 * Which batch this line dispenses from.
 *
 * Only rendered for a batch-tracked product. Leaving it alone is the normal
 * path — the till takes the nearest expiry (FEFO) on its own, which is what a
 * counter wants almost every time. The picker exists for when the operator has
 * a specific strip in hand: a customer returning to match an earlier purchase,
 * a batch the pharmacist wants cleared first, or two batches on the shelf at
 * different printed MRPs.
 *
 * The MRP shown per batch is not decoration. It becomes the ceiling the line is
 * billed under, so the operator can see before choosing that this strip caps
 * lower than the product's usual price.
 */
export function BatchPicker({
  productId,
  productName,
  baseUnit,
  selected,
  onSelect,
}: {
  productId: string;
  productName: string;
  baseUnit: string;
  selected?: SellableBatch;
  onSelect: (batch?: SellableBatch) => void;
}) {
  const { t } = useAppLanguage();
  const [open, setOpen] = useState(false);

  // Only fetched once the operator opens the picker: a cart of batch-tracked
  // lines would otherwise fire a request per line on every render.
  const query = useQuery({
    queryKey: ["sellable-batches", productId],
    queryFn: () => listSellableBatches(productId),
    enabled: open,
    staleTime: 15_000,
  });

  const batches = query.data ?? [];

  return (
    <div className="mt-1">
      <button
        type="button"
        data-testid={`batch-picker-${productId}`}
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={t("billing.batch.chooseFor", { name: productName })}
        className={cn(
          "inline-flex items-center gap-1 rounded-[6px] px-1 py-[1px] text-[10px] font-bold leading-none -ml-1 transition-colors hover:bg-[#eef4ff]",
          selected ? "text-[var(--brand)]" : "text-[#9aa7bd] hover:text-[var(--brand)]",
        )}
      >
        <Layers size={10} aria-hidden="true" />
        {selected ? t("billing.batch.selected", { number: selected.batchNumber }) : t("billing.batch.nearestExpiry")}
      </button>

      {open ? (
        <div className="mt-1 max-h-44 w-full max-w-[260px] overflow-y-auto rounded-md border bg-white p-1 shadow-sm">
          <button
            type="button"
            onClick={() => { onSelect(undefined); setOpen(false); }}
            className={cn("block w-full rounded px-2 py-1 text-left text-[10px] font-semibold hover:bg-[#f3f7ff]", !selected && "bg-[#eef4ff] text-[var(--brand)]")}
          >
            {t("billing.batch.nearestExpiryAuto")}
          </button>

          {query.isLoading ? (
            <p className="px-2 py-2 text-[10px] text-[#9aa7bd]">{t("billing.batch.loading")}</p>
          ) : batches.length === 0 ? (
            <p className="px-2 py-2 text-[10px] text-[#9aa7bd]">{t("billing.batch.empty")}</p>
          ) : (
            batches.map((batch) => {
              const days = daysLeft(batch.expiresOn);
              return (
                <button
                  key={batch.id}
                  type="button"
                  onClick={() => { onSelect(batch); setOpen(false); }}
                  className={cn(
                    "block w-full rounded px-2 py-1 text-left text-[10px] hover:bg-[#f3f7ff]",
                    selected?.id === batch.id && "bg-[#eef4ff]",
                  )}
                >
                  <span className="font-mono font-bold text-[#2F3446]">{batch.batchNumber}</span>
                  {batch.mrp ? <span className="ml-1 font-semibold text-[#1a8a4e]">{t("billing.batch.mrp", { amount: batch.mrp.toLocaleString("en-IN") })}</span> : null}
                  <span className={cn("ml-1 font-semibold", days <= 30 ? "text-amber-700" : "text-[#7C7566]")}>
                    {days < 0 ? t("billing.batch.expiredAgo", { days: Math.abs(days) }) : t("billing.batch.daysLeft", { days })}
                  </span>
                  <span className="ml-1 text-[#9aa7bd]">{batch.availableBaseQty} {baseUnit}</span>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
