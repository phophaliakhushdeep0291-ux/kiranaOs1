import { useQuery } from "@tanstack/react-query";
import { registerBillingSlot, type BillingSlotProps } from "@/features/core/billing/billing-slots";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { listProductUnits } from "./api";
import { prepareUnitBillItems, selectedUnits } from "./billing-selection";

function UnitPicker({ cart = [], value, onChange }: BillingSlotProps) {
  const { t } = useAppLanguage();
  const units = useQuery({ queryKey: ["product-units"], queryFn: () => listProductUnits() });
  const selected = selectedUnits(value);
  const quantities = new Map<string, { name: string; quantity: number }>();
  for (const line of cart) {
    const previous = quantities.get(line.product.id);
    quantities.set(line.product.id, { name: line.product.name, quantity: (previous?.quantity ?? 0) + line.quantity });
  }
  return <div className="mt-2 space-y-2 rounded-lg border p-3">
    <p className="text-xs font-bold">{t("workflow.electronics.billing.title")}</p>
    <p className="text-xs text-slate-600">{t("workflow.electronics.billing.hint")}</p>
    {units.isError && <p role="alert" className="text-xs text-red-700">{t("workflow.electronics.billing.loadFailed")}</p>}
    {[...quantities].map(([productId, product]) => {
      const registered = units.data?.filter((unit) => unit.productId === productId) ?? [];
      if (!registered.length) return null;
      const chosen = selected.filter((unit) => unit.productId === productId);
      return <fieldset key={productId} className="space-y-1">
        <legend className="text-xs font-semibold">{product.name} · {chosen.length}/{product.quantity}</legend>
        {registered.filter((unit) => unit.canSell || chosen.some((pick) => pick.id === unit.id)).map((unit) => {
          const checked = chosen.some((pick) => pick.id === unit.id);
          return <label key={unit.id} className="flex min-h-10 items-center gap-2 text-xs">
            <input type="checkbox" checked={checked} disabled={!checked && (!unit.canSell || chosen.length >= product.quantity)} onChange={() => onChange(checked
              ? selected.filter((pick) => pick.id !== unit.id)
              : [...selected, { id: unit.id, productId, label: unit.imei || unit.serialNumber || unit.id }])} />
            {unit.imei || unit.serialNumber}
          </label>;
        })}
      </fieldset>;
    })}
  </div>;
}
registerBillingSlot({ id: "trackedUnits", Component: UnitPicker,
  appliesTo: ({ businessType, productIds }) => businessType === "electronics" && productIds.length > 0,
  prepareItems: prepareUnitBillItems,
});
