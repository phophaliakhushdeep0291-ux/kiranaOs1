import { useQuery } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { getVariantStockByLocation } from "@/features/core/products/api";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { cn } from "@/lib/utils";

/**
 * Where each size physically is.
 *
 * The grid above says the shop owns four L-Blue shirts. This says one is on the
 * counter and three are at the second branch — which is the difference between
 * promising a customer a size and actually having it in the room.
 *
 * Read-only on purpose. Stock moves through sales, purchases and transfers, and
 * a box you can type a new number into here would be a fourth way to move stock
 * that no ledger row explains.
 */
export function VariantLocationSplit({ productId }: { productId: string }) {
  const { t } = useAppLanguage();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["product-variant-stock", productId],
    queryFn: () => getVariantStockByLocation(productId),
    // Only ever asked for a saved product, and stock moves under it constantly.
    staleTime: 15_000,
  });

  // Nothing to say for a product with no sizes, and nothing worth a spinner or an
  // error box either — this panel is a detail beside the grid, not the page.
  if (isLoading || isError || !data || data.locations.length === 0) return null;

  const units = data.locations[0]?.units ?? [];
  if (units.length === 0) return null;

  // A one-branch shop already knows where everything is; the grid said so.
  if (data.locations.length < 2) return null;

  const totalFor = (sellingUnitId: string) =>
    data.locations.reduce(
      (sum, location) => sum + (location.units.find((u) => u.sellingUnitId === sellingUnitId)?.qty ?? 0),
      0,
    );

  return (
    <div className="space-y-2 rounded-[12px] border border-[#e3eaf3] bg-[#fbfcfe] p-3" data-testid="variant-location-split">
      <div className="flex items-center gap-1.5">
        <MapPin size={13} className="text-[var(--brand)]" />
        <p className="text-[12px] font-black text-[#13274d]">{t("products.variantSplit.title")}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[320px] border-collapse text-[11px]">
          <thead>
            <tr className="border-b border-[#e3eaf3]">
              <th scope="col" className="py-1.5 pr-2 text-left font-black text-[#52627e]">{t("products.variantSplit.size")}</th>
              {data.locations.map((location) => (
                <th key={location.id} scope="col" className="px-2 py-1.5 text-right font-black text-[#52627e]">
                  {location.name}
                  {location.isPrimary && <span className="ml-1 font-semibold text-[#8d9bb5]">{t("products.variantSplit.main")}</span>}
                </th>
              ))}
              <th scope="col" className="py-1.5 pl-2 text-right font-black text-[#13274d]">{t("products.variantSplit.total")}</th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => {
              const total = totalFor(unit.sellingUnitId);
              return (
                <tr key={unit.sellingUnitId} className="border-b border-[#eef2f7] last:border-0">
                  <th scope="row" className="py-1.5 pr-2 text-left font-bold text-[#344668]">
                    {[unit.variantValue1, unit.variantValue2].filter(Boolean).join(" / ") || unit.name}
                  </th>
                  {data.locations.map((location) => {
                    const qty = location.units.find((u) => u.sellingUnitId === unit.sellingUnitId)?.qty ?? 0;
                    return (
                      <td
                        key={location.id}
                        className={cn(
                          "px-2 py-1.5 text-right font-bold tabular-nums",
                          // A branch that has run out of one size is the thing worth
                          // spotting here, so it should not read like every other cell.
                          qty <= 0 ? "text-[#b0bbcd]" : "text-[#13274d]",
                        )}
                      >
                        {qty}
                      </td>
                    );
                  })}
                  <td
                    className={cn(
                      "py-1.5 pl-2 text-right font-black tabular-nums",
                      total <= 0 ? "text-rose-600" : "text-[#13274d]",
                    )}
                  >
                    {total}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] font-semibold leading-snug text-[#6d7c98]">
        {t("products.variantSplit.hint")}
      </p>
    </div>
  );
}
