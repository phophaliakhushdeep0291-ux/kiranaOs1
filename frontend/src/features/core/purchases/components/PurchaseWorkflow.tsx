import { useAppLanguage } from "@/features/core/settings/i18n";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const PURCHASE_STEPS = ["1. Order", "2. Receive stock", "3. Record bill", "4. Settle due"];

export function PurchaseWorkflow({ children }: { children: ReactNode }) {
  const { t } = useAppLanguage();
  const [showPlanning, setShowPlanning] = useState(false);

  return (
    <>
      <section className="rounded-[14px] border border-[#e6ecf4] bg-white px-4 py-3 shadow-[0_8px_24px_rgba(15,35,80,0.04)]" aria-label={t("chrome.purchaseWorkflow")}>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            {PURCHASE_STEPS.map((step) => (
              <div key={step} className="rounded-[10px] bg-[#f7f9fc] px-3 py-2 text-[11px] font-bold text-[#344563]">{step}</div>
            ))}
          </div>
          <Button
            data-purchase-planning-toggle
            variant="outline"
            className="h-11 gap-1.5 rounded-[9px] text-[12px] font-bold lg:mouse:h-9"
            onClick={() => setShowPlanning((open) => !open)}
            aria-expanded={showPlanning}
            aria-controls={showPlanning ? "purchase-planning-panel" : undefined}
          >
            Planning insights
            <ChevronDown size={14} className={cn("transition-transform", showPlanning && "rotate-180")} />
          </Button>
        </div>
      </section>
      {showPlanning && <div id="purchase-planning-panel" className="contents">{children}</div>}
    </>
  );
}
