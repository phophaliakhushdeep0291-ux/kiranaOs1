import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Loader2, ScanLine } from "lucide-react";
import { registerBillingSlot, type BillingSlotProps } from "@/features/core/billing/billing-slots";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useOfflineStatus } from "@/features/core/sync";
import type { ProductUnit } from "@/types/api";
import { getUnitBillingOptions, lookupProductUnit } from "./api";
import {
  TRACKED_UNITS_SLOT, piecesByProduct, prepareUnitBillItems, pruneSelection, selectedUnits,
  type SelectedUnit,
} from "./billing-selection";

/** Units listed per product before the rest are left to the scan box. */
const SHOWN_PER_PRODUCT = 6;

const labelOf = (unit: ProductUnit) => unit.imei || unit.serialNumber || unit.id;
const codesOf = (unit: ProductUnit) => [unit.imei, unit.imei2, unit.serialNumber].filter((code): code is string => Boolean(code)).map((code) => code.toUpperCase());

/**
 * Which handset is this?
 *
 * The bill and the IMEI register used to be two acts, and the second — walking
 * to the register to mark that unit sold — is the one a busy counter forgets.
 * This asks while the phone is still on the counter: one serial per piece,
 * scanned off the box or ticked from the shelf list, and the bill records the
 * sale, the buyer and the start of the warranty when it saves.
 *
 * Shown only for products the register has ever recorded a unit of. A shop's
 * chargers and covers ring up with nothing extra on the screen.
 *
 * It never stands in the way. With no connection a serial cannot be reserved,
 * so it says so and the bill goes out without one; with nothing registered on
 * the shelf it says that too. `billing-serial-check` asks the cashier to confirm
 * either before the money is taken.
 */
function UnitPicker({ cart = [], value, onChange }: BillingSlotProps) {
  const { t } = useAppLanguage();
  const { isOnline } = useOfflineStatus();
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const pieces = useMemo(() => piecesByProduct(cart), [cart]);
  const productIds = useMemo(() => [...pieces.keys()].sort(), [pieces]);
  const selection = useMemo(() => selectedUnits(value), [value]);

  // Asked afresh for every bill: the unit sold a moment ago must not be offered
  // again. "always", because the default pauses a query while offline — and
  // offline is exactly when this has to answer from what the device remembers.
  const options = useQuery({
    queryKey: ["product-units", "billing-options", productIds.join(",")],
    queryFn: () => getUnitBillingOptions(productIds),
    enabled: productIds.length > 0,
    networkMode: "always",
    retry: 1,
    gcTime: 0,
  });

  // The cart changes under a choice — a line removed, a quantity lowered. What
  // no longer fits is dropped rather than left claiming "2 of 1".
  useEffect(() => {
    const kept = pruneSelection(selection, cart);
    if (kept !== selection) onChange(kept);
  }, [selection, cart, onChange]);

  const tracked = options.data?.options ?? [];
  const reachable = isOnline && options.data?.live !== false;
  // A unit sent over from the register is shown at once, before the shelf list arrives.
  const shownProductIds = [...new Set([...tracked.map((option) => option.productId), ...selection.map((unit) => unit.productId)])]
    .filter((productId) => pieces.has(productId));

  const anythingTracked = shownProductIds.length > 0;

  if (!reachable) {
    // Said only about a bill this device knows holds a serial-tracked product. A
    // charger sold offline needs no warning about serials it never had.
    return anythingTracked ? (
      <div role="status" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-2.5 py-2 text-[11px] font-semibold leading-4 text-amber-900">
        {t("workflow.electronics.billing.offline")}
      </div>
    ) : null;
  }
  if (!anythingTracked && !options.isError) return null;

  function toggle(unit: SelectedUnit) {
    setNotice(null);
    onChange(selection.some((pick) => pick.id === unit.id)
      ? selection.filter((pick) => pick.id !== unit.id)
      : [...selection, unit]);
  }

  /** The scan box: a code off the box picks that exact unit, wherever it sits in the list. */
  async function addByCode() {
    const wanted = code.trim().toUpperCase();
    if (!wanted || looking) return;
    setNotice(null);
    let unit = tracked.flatMap((option) => option.units).find((candidate) => codesOf(candidate).includes(wanted));
    if (!unit) {
      // Older stock is beyond the listed few; the register itself still knows it.
      setLooking(true);
      try {
        unit = (await lookupProductUnit(wanted)) ?? undefined;
      } catch {
        setNotice(t("workflow.electronics.billing.scan.failed"));
        return;
      } finally {
        setLooking(false);
      }
    }
    if (!unit) return setNotice(t("workflow.electronics.billing.scan.unknown", { code: wanted }));
    const found = unit;
    if (selection.some((pick) => pick.id === found.id)) return setCode("");
    const line = pieces.get(found.productId);
    if (!line) return setNotice(t("workflow.electronics.billing.scan.otherProduct", { code: wanted, name: found.productName }));
    if (!found.canSell) return setNotice(t("workflow.electronics.billing.scan.unavailable", { code: wanted }));
    if (selection.filter((pick) => pick.productId === found.productId).length >= line.pieces) {
      return setNotice(t("workflow.electronics.billing.scan.full", { name: line.name }));
    }
    onChange([...selection, { id: found.id, productId: found.productId, label: labelOf(found) }]);
    setCode("");
  }

  const term = code.trim().toUpperCase();

  return (
    <div className="mt-2 space-y-2 rounded-lg border border-[#dce5f1] bg-white p-2.5" data-testid="serial-picker">
      <div>
        <p className="text-[11px] font-black text-[var(--brand-ink)]">{t("workflow.electronics.billing.title")}</p>
        <p className="text-[10px] leading-4 text-[#64748b]">{t("workflow.electronics.billing.hint")}</p>
      </div>

      <div className="relative">
        <ScanLine size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[#94a3b8]" aria-hidden="true" />
        <input
          value={code}
          onChange={(event) => { setCode(event.target.value); setNotice(null); }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            // A scanner ends its read with Enter; it must not reach the bill's own shortcuts.
            event.preventDefault();
            event.stopPropagation();
            void addByCode();
          }}
          placeholder={t("workflow.electronics.billing.scan.placeholder")}
          aria-label={t("workflow.electronics.billing.scan.label")}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="h-9 w-full rounded-md border border-[#dce5f1] pl-7 pr-7 font-mono text-[11px] font-semibold"
        />
        {looking && <Loader2 size={13} className="absolute right-2 top-1/2 -translate-y-1/2 animate-spin text-[#94a3b8]" aria-hidden="true" />}
      </div>
      {notice && <p role="alert" className="text-[10px] font-semibold leading-4 text-rose-700">{notice}</p>}

      {options.isLoading && <p className="text-[10px] text-[#64748b]">{t("workflow.electronics.billing.loading")}</p>}
      {options.isError && <p role="alert" className="text-[10px] font-semibold leading-4 text-rose-700">{t("workflow.electronics.billing.loadFailed")}</p>}

      {shownProductIds.map((productId) => {
        const line = pieces.get(productId)!;
        const option = tracked.find((entry) => entry.productId === productId);
        const chosen = selection.filter((unit) => unit.productId === productId);
        const full = chosen.length >= line.pieces;
        const onShelf = (option?.units ?? []).filter((unit) => !chosen.some((pick) => pick.id === unit.id));
        const matching = term ? onShelf.filter((unit) => codesOf(unit).some((candidate) => candidate.includes(term))) : onShelf;
        const listed = matching.slice(0, SHOWN_PER_PRODUCT);
        // Counted against the shelf, not the list: the list is capped and the shelf may hold more.
        const unlisted = term ? matching.length - listed.length : Math.max(0, (option?.sellableCount ?? 0) - chosen.length - listed.length);
        return (
          <fieldset key={productId} className="space-y-1">
            <legend className="text-[11px] font-bold text-[#344668]">
              {line.name} · {t("workflow.electronics.billing.chosen", { chosen: chosen.length, needed: line.pieces })}
            </legend>
            {chosen.map((unit) => (
              <label key={unit.id} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-md bg-emerald-50 px-2 font-mono text-[11px] font-semibold text-emerald-900">
                <input type="checkbox" className="h-4 w-4 accent-emerald-600" checked onChange={() => toggle(unit)} />
                {unit.label}
              </label>
            ))}
            {listed.map((unit) => (
              <label key={unit.id} className={`flex min-h-9 items-center gap-2 rounded-md px-2 font-mono text-[11px] ${full ? "text-[#94a3b8]" : "cursor-pointer text-[#344668] hover:bg-[#f3f7ff]"}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--brand)]"
                  checked={false}
                  disabled={full}
                  onChange={() => toggle({ id: unit.id, productId, label: labelOf(unit) })}
                />
                <span className="min-w-0 truncate">{labelOf(unit)}</span>
                {unit.condition !== "new" && (
                  <span className="shrink-0 rounded bg-[#f1f5fa] px-1.5 py-0.5 font-sans text-[10px] font-bold text-[#52627e]">
                    {t(unit.condition === "open_box" ? "workflow.electronics.condition.openBox" : "workflow.electronics.condition.refurbished")}
                  </span>
                )}
              </label>
            ))}
            {unlisted > 0 && <p className="px-2 text-[10px] text-[#64748b]">{t("workflow.electronics.billing.more", { count: unlisted })}</p>}
            {option && option.sellableCount === 0 && chosen.length === 0 && (
              <p className="px-2 text-[10px] font-semibold leading-4 text-amber-800">{t("workflow.electronics.billing.noneInStock")}</p>
            )}
          </fieldset>
        );
      })}
    </div>
  );
}

/**
 * How shared billing gets a serial control without importing electronics.
 *
 * Applies to any bill in an electronics shop; the control itself renders nothing
 * until the register says one of the products on it is sold by serial. The trade
 * is checked because a registration outlives a switch to another shop in the
 * same session.
 */
export function registerUnitBillingSlot() {
  registerBillingSlot({
    id: TRACKED_UNITS_SLOT,
    Component: UnitPicker,
    appliesTo: ({ businessType, productIds }) => businessType === "electronics" && productIds.length > 0,
    prepareItems: prepareUnitBillItems,
  });
}

registerUnitBillingSlot();
