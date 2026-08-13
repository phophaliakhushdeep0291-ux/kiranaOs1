import { Loader2, Plus, ReceiptText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAppLanguage } from "@/features/core/settings/i18n";

export interface OpenBillChip {
  id: string;
  name: string;
  itemCount: number;
  active: boolean;
  /** Parked long enough to warn the cashier it may be forgotten. */
  stale?: boolean;
  /** Human age for the tooltip, e.g. "3h ago". */
  ageLabel?: string;
}

/**
 * Always-visible strip of the bills currently open at the counter. The active bill is
 * highlighted; tapping another switches to it (the current one is saved automatically).
 * "New bill" parks the current bill and starts a fresh one — so several customers can be
 * served at once without losing anyone's cart.
 */
export function OpenBillsBar({ bills, onSwitch, onNew, busy = false }: {
  bills: OpenBillChip[];
  onSwitch: (id: string) => void | Promise<void>;
  onNew: () => void | Promise<unknown>;
  busy?: boolean;
}) {
  const { t } = useAppLanguage();

  return (
    <div aria-busy={busy} className="app-scrollbar mb-2 flex shrink-0 items-center gap-2 overflow-x-auto rounded-[10px] border border-[#e6ecf4] bg-[#f7f9fd] px-2 py-1.5">
      <span className="shrink-0 pl-1 pr-0.5 text-[11px] font-bold uppercase tracking-wide text-[#64748b]">{t("billing.openBills")}</span>
      {bills.map((bill) => (
        <button
          key={bill.id}
          type="button"
          onClick={() => { if (!bill.active) void onSwitch(bill.id); }}
          disabled={busy}
          aria-current={bill.active}
          title={bill.active
            ? t("billing.openBills.current")
            : bill.ageLabel
              ? t("billing.openBills.switchToParked", { name: bill.name, age: bill.ageLabel })
              : t("billing.openBills.switchTo", { name: bill.name })}
          className={cn(
            // Switching between the customers standing at the counter is a
            // thumb action, so the chip carries a phone-sized target and drops
            // back to the compact desktop height where a mouse takes over.
            "flex h-11 shrink-0 items-center gap-1.5 rounded-[8px] border px-2.5 text-[12px] font-bold transition-colors disabled:pointer-events-none disabled:opacity-60 lg:mouse:h-auto lg:mouse:py-1",
            bill.active
              ? "border-[var(--brand)] bg-white text-[var(--brand)] shadow-[0_2px_8px_rgba(0,87,255,0.15)]"
              : bill.stale
                ? "border-amber-300 bg-amber-50 text-amber-700 hover:border-amber-400"
                : "border-[#dbe3ef] bg-white text-[#475569] hover:border-[var(--brand)] hover:text-[var(--brand)]",
          )}
        >
          {bill.stale ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" /> : <ReceiptText size={13} />}
          <span className="max-w-[120px] truncate">{bill.name}</span>
          <span className="rounded-full bg-[#eef2f8] px-1.5 text-[10px] font-bold text-[#64748b]">{bill.itemCount}</span>
        </button>
      ))}
      <button
        type="button"
        onClick={() => { void onNew(); }}
        disabled={busy}
        title={t("billing.openBills.startNew")}
        className="ml-auto flex h-11 shrink-0 items-center gap-1 rounded-[8px] border border-dashed border-[var(--brand)] px-2.5 text-[12px] font-bold text-[var(--brand)] hover:bg-[var(--brand-soft)] disabled:pointer-events-none disabled:opacity-60 lg:mouse:h-auto lg:mouse:py-1"
      >
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} {t("billing.openBills.new")}
      </button>
    </div>
  );
}
