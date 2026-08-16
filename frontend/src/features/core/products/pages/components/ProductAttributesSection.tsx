import { useId } from "react";
import type { UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { X } from "lucide-react";
import type { BusinessType } from "@/features/core/settings/business-type-store";
import {
  foreignProductAttributeKeys,
  productAttributeGroupsFor,
  PRODUCT_ATTRIBUTE_UI_TEXT,
  type ProductAttributeField,
  type ProductAttributes,
} from "@/features/core/products/product-attributes";
import type { ProductFormData } from "../product-form-state";

/**
 * The trade's own fields on the product form, rendered from the catalogue.
 *
 * Every word on screen here comes from product-attributes.ts — the labels, the
 * group headings, even "Not set". That is deliberate twice over: this file is a
 * new .tsx, and the i18n check enforces strictly on any component not already
 * grandfathered, so a literal written here would fail the build. It also means
 * one file holds the whole vocabulary of every trade, which is what makes adding
 * a field to a shop type a one-line change rather than a form edit.
 *
 * Values live in the form under a single `attributes` key rather than as
 * registered fields, because the field list changes with the business type and
 * react-hook-form would otherwise carry a different shape per trade.
 */
export function ProductAttributesSection({
  businessType,
  form,
}: {
  businessType: BusinessType;
  form: UseFormReturn<ProductFormData>;
}) {
  const groups = productAttributeGroupsFor(businessType);
  const attributes = (form.watch("attributes") ?? {}) as ProductAttributes;
  const foreignKeys = foreignProductAttributeKeys(businessType, attributes);

  function setAttribute(key: string, value: string | number | boolean | undefined) {
    const next: ProductAttributes = { ...attributes };
    // An empty box is not a stored empty string: "cleared" and "never filled in"
    // are the same fact, and keeping both spellings would make the dirty check
    // report an edit the shopkeeper never made.
    if (value === undefined || value === "" || (typeof value === "number" && !Number.isFinite(value))) delete next[key];
    else next[key] = value;
    form.setValue("attributes", next, { shouldDirty: true });
  }

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.id}>
          <p className="text-[12px] font-black text-[#13274d]">{group.label}</p>
          {group.help ? <p className="mt-0.5 text-[10.5px] font-semibold leading-4 text-[#65748f]">{group.help}</p> : null}
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.fields.map((field) => (
              <AttributeControl
                key={field.key}
                field={field}
                value={attributes[field.key]}
                onChange={(value) => setAttribute(field.key, value)}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Details this shop's current trade has no field for — kept, not pruned,
          because they are still true about the product and a shop that switched
          business type would otherwise lose them on the next save without ever
          being told. Shown read-only with a way to drop the ones that no longer
          apply. */}
      {foreignKeys.length > 0 ? (
        <div className="rounded-[12px] border border-[#e6ecf4] bg-[#f8fafc] p-3" data-testid="product-foreign-attributes">
          <p className="text-[12px] font-black text-[#13274d]">{PRODUCT_ATTRIBUTE_UI_TEXT.foreignTitle}</p>
          <p className="mt-0.5 text-[10.5px] font-semibold leading-4 text-[#65748f]">{PRODUCT_ATTRIBUTE_UI_TEXT.foreignHelp}</p>
          <ul className="mt-2 space-y-1.5">
            {foreignKeys.map((key) => (
              <li key={key} className="flex items-center justify-between gap-3 rounded-[8px] bg-white px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate text-[11.5px] font-semibold text-[#45577a]">
                  {key}
                  {": "}
                  {String(attributes[key])}
                </span>
                <button
                  type="button"
                  onClick={() => setAttribute(key, undefined)}
                  aria-label={`${PRODUCT_ATTRIBUTE_UI_TEXT.removeLabel} ${key}`}
                  className="shrink-0 rounded-full p-1 text-[#9aa6bb] transition-colors hover:bg-rose-50 hover:text-rose-600"
                >
                  <X size={13} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function AttributeControl({
  field,
  value,
  onChange,
}: {
  field: ProductAttributeField;
  value: string | number | boolean | undefined;
  onChange: (value: string | number | boolean | undefined) => void;
}) {
  const id = `product-attribute-${field.key}-${useId().replace(/:/g, "")}`;
  const help = field.help ? <p className="mt-1 text-[10px] font-semibold leading-4 text-[#9aa6bb]">{field.help}</p> : null;

  // A switch reads as a statement, not as a labelled box, so it keeps its label
  // beside it rather than above — the same shape the batch-tracking toggle uses.
  if (field.type === "boolean") {
    return (
      <div className={`flex items-start justify-between gap-3 rounded-[10px] border border-[#e3eaf3] bg-white px-3 py-2.5 ${field.help ? "sm:col-span-2" : ""}`}>
        <div className="min-w-0">
          <Label htmlFor={id} className="block text-[12px] font-semibold text-[#45577a]">{field.label}</Label>
          {help}
        </div>
        <Switch
          id={id}
          checked={value === true}
          onCheckedChange={(checked) => onChange(checked)}
          aria-label={field.label}
        />
      </div>
    );
  }

  return (
    <div className={field.type === "textarea" ? "sm:col-span-2" : undefined}>
      <Label htmlFor={id} className="mb-1.5 block text-[12px] font-semibold text-[#45577a]">{field.label}</Label>

      {field.type === "select" ? (
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value || undefined)}
          aria-label={field.label}
          className="h-10 w-full rounded-md border border-[#e6ecf4] bg-white px-2 text-[12px] font-semibold text-[#13274d]"
        >
          <option value="">{PRODUCT_ATTRIBUTE_UI_TEXT.unsetOption}</option>
          {(field.options ?? []).map((option) => (
            <option key={option} value={option}>{option}</option>
          ))}
        </select>
      ) : field.type === "textarea" ? (
        <textarea
          id={id}
          rows={2}
          maxLength={field.maxLength}
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          onChange={(event) => onChange(event.target.value)}
          aria-label={field.label}
          className="w-full resize-none rounded-[10px] border border-[#e3eaf3] bg-white px-3 py-2 text-[13px] text-[var(--brand-ink)] placeholder:text-[#6b7a9a] focus:border-[var(--brand)] focus:outline-none focus:ring-0"
        />
      ) : field.type === "number" ? (
        <div className="relative">
          <Input
            id={id}
            className="h-10 pr-12"
            type="number"
            inputMode="decimal"
            min={field.min}
            max={field.max}
            step={field.step}
            placeholder={field.placeholder}
            value={typeof value === "number" ? String(value) : ""}
            // Never `Number(value) || 0`: on the keystroke that empties the box
            // that writes a real zero, and a zero shelf life or a zero warranty
            // is a claim the shop never made. An empty box clears the field.
            onChange={(event) => {
              const raw = event.target.value.trim();
              if (!raw) return onChange(undefined);
              const parsed = Number(raw);
              onChange(Number.isFinite(parsed) ? parsed : undefined);
            }}
            aria-label={field.label}
          />
          {field.suffix ? (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[11px] font-bold text-[#9aa6bb]">{field.suffix}</span>
          ) : null}
        </div>
      ) : (
        <Input
          id={id}
          className="h-10"
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(event.target.value)}
          aria-label={field.label}
        />
      )}

      {help}
    </div>
  );
}
