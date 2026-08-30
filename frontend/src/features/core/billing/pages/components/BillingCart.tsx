import { useEffect, useRef, useState } from "react";
import { BadgePercent, Loader2, Pencil, Scale, ShoppingCart, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuantityDraft } from "@/components/ui/input";
import { cartItemGross, cartItemLineDiscount, cartItemNet, productMinSellingPrice, roundMoney } from "../billing-calculations";
import { addonUnitPrice, cartItemKey, type CartItem } from "../billing-types";
import { BatchPicker } from "./BatchPicker";
import type { SellableBatch } from "@/features/core/inventory/inventory-lots-api";
import { getProductEmoji, productPlaceholderColor } from "./BillingSearch";
import { isScaleBillingUnit } from "@/features/core/hardware/local-hardware-bridge";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { useShopBillingWords } from "@/features/core/settings/shop-billing";

interface BillingCartProps {
  cart: CartItem[];
  onUpdateQty: (lineKey: string, nextQuantity: number) => void;
  onUpdateRate: (lineKey: string, nextRate: number) => void;
  onUpdateUnit: (lineKey: string, unit: string) => void;
  onUpdateLineDiscount: (lineKey: string, amount: number) => void;
  onUpdateLineNote: (lineKey: string, note: string) => void;
  onUpdateLineBatch: (lineKey: string, batch?: SellableBatch) => void;
  onReadScale: (lineKey: string, billingUnit: string) => void;
  scaleReadingLineKey: string | null;
  onRemoveItem: (lineKey: string) => void;
}

export function BillingCart({ cart, onUpdateQty, onUpdateRate, onUpdateUnit, onUpdateLineDiscount, onUpdateLineNote, onUpdateLineBatch, onReadScale, scaleReadingLineKey, onRemoveItem }: BillingCartProps) {
  const { t } = useAppLanguage();
  const words = useShopBillingWords();

  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#FAF7F0] text-[#6B6455]">
          <ShoppingCart size={20} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-bold text-[#1B2145]">{t("billing.cart.empty")}</p>
          <p className="mt-0.5 text-xs text-[#6B6455]">{t("billing.cart.emptyHint", { items: words.items })}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {cart.map((item) => (
        <CartRow
          key={cartItemKey(item)}
          item={item}
          onUpdateQty={onUpdateQty}
          onUpdateRate={onUpdateRate}
          onUpdateUnit={onUpdateUnit}
          onUpdateLineDiscount={onUpdateLineDiscount}
          onUpdateLineNote={onUpdateLineNote}
          onUpdateLineBatch={onUpdateLineBatch}
          onReadScale={onReadScale}
          scaleReading={scaleReadingLineKey === cartItemKey(item)}
          onRemoveItem={onRemoveItem}
        />
      ))}
    </div>
  );
}

function CartRow({
  item,
  onUpdateQty,
  onUpdateRate,
  onUpdateUnit,
  onUpdateLineDiscount,
  onUpdateLineNote,
  onUpdateLineBatch,
  onReadScale,
  scaleReading,
  onRemoveItem,
}: {
  item: CartItem;
  onUpdateQty: (id: string, qty: number) => void;
  onUpdateRate: (id: string, rate: number) => void;
  onUpdateUnit: (id: string, unitCode: string) => void;
  onUpdateLineDiscount: (id: string, amount: number) => void;
  onUpdateLineNote: (id: string, note: string) => void;
  onUpdateLineBatch: (id: string, batch?: SellableBatch) => void;
  onReadScale: (id: string, billingUnit: string) => void;
  scaleReading: boolean;
  onRemoveItem: (id: string) => void;
}) {
  const { t } = useAppLanguage();
  const [editingRate, setEditingRate] = useState(false);
  const [rateDraft, setRateDraft] = useState<string>(String(item.rate));
  const rateInputRef = useRef<HTMLInputElement | null>(null);
  const [editingDiscount, setEditingDiscount] = useState(false);
  const [discountDraft, setDiscountDraft] = useState<string>("");
  const discountInputRef = useRef<HTMLInputElement | null>(null);
  const lineGross = cartItemGross(item);
  const lineDiscount = cartItemLineDiscount(item);
  const lineTotal = cartItemNet(item);
  const isBelowMin =
    !item.isCustom &&
    productMinSellingPrice(item.product) > 0 &&
    item.rate < productMinSellingPrice(item.product);
  const color = productPlaceholderColor(item.product.name);
  const emoji = getProductEmoji(item.product.name, item.product.category);
  const sellingUnits = (item.product.sellingUnits ?? []).filter((unit) => unit.isActive !== false);
  const lineKey = cartItemKey(item);
  const guestLocked = Boolean(item.guestSnapshot || item.guestOrderId || item.guestOrderLineId);
  const qtyProps = useQuantityDraft(item.quantity, (next) => onUpdateQty(lineKey, next));
  const scaleUnit = item.sellingUnit?.unitType ?? item.product.rateUnit ?? item.product.unit ?? item.unit;
  const canReadScale = item.product.isLooseItem === true && isScaleBillingUnit(scaleUnit);

  function startEditRate() {
    setRateDraft(String(item.rate));
    setEditingRate(true);
  }

  function onRateDraftChange(next: string) {
    // Keep the raw text so "12." / "" feel natural, but push the parsed rate live so the line
    // total updates as you type.
    setRateDraft(next);
    const parsed = Number(next);
    if (next.trim() !== "" && Number.isFinite(parsed) && parsed >= 0) {
      onUpdateRate(lineKey, parsed);
    }
  }

  function commitRate() {
    const parsed = Number(rateDraft);
    const safe = rateDraft.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : item.rate;
    onUpdateRate(lineKey, safe);
    setRateDraft(String(safe));
    setEditingRate(false);
  }

  useEffect(() => {
    if (editingRate) {
      rateInputRef.current?.focus();
      rateInputRef.current?.select();
    }
  }, [editingRate]);

  function startEditDiscount() {
    setDiscountDraft(lineDiscount > 0 ? String(lineDiscount) : "");
    setEditingDiscount(true);
  }

  function commitDiscount() {
    // "10" = ₹10 off the line; "10%" = 10% of the line's gross amount.
    const raw = discountDraft.trim();
    const isPercent = raw.endsWith("%");
    const parsed = Number(isPercent ? raw.slice(0, -1) : raw);
    if (raw === "" || !Number.isFinite(parsed) || parsed <= 0) {
      onUpdateLineDiscount(lineKey, 0);
    } else {
      onUpdateLineDiscount(lineKey, isPercent ? roundMoney(lineGross * Math.min(parsed, 100) / 100) : parsed);
    }
    setEditingDiscount(false);
  }

  useEffect(() => {
    if (editingDiscount) {
      discountInputRef.current?.focus();
      discountInputRef.current?.select();
    }
  }, [editingDiscount]);

  return (
    <div
      data-testid={`cart-item-${item.product.id}`}
      className="grid grid-cols-[34px_minmax(0,1fr)_44px] items-start gap-x-2 gap-y-3 border-b border-[#edf1f6] px-2.5 py-3 last:border-b-0 sm:grid-cols-[34px_minmax(0,1fr)_134px_60px_44px] sm:items-center sm:gap-[9px]"
    >
      {/* Thumbnail */}
      <div className={`col-start-1 row-start-1 grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-[7px] text-lg sm:col-auto sm:row-auto ${color}`}>
        {item.product.imageUrl ? <img src={item.product.imageUrl} alt="" className="h-full w-full object-contain" /> : emoji}
      </div>

      {/* Name + editable rate */}
      <div className="col-start-2 row-start-1 min-w-0 sm:col-auto sm:row-auto">
        <p className="truncate text-[12px] font-extrabold leading-[1.2] text-[#1B2145]">
          {item.product.name}
        </p>
        {(item.guestSnapshot || item.guestOrderId) && <p className="mt-1 text-[11px] font-medium text-[#6B6455]">{t("billing.cart.guestItemProtected")}</p>}
        {item.addons?.length ? (
          <div className="mt-1 flex max-w-full flex-wrap gap-1" data-testid={`addons-${item.product.id}`}>
            {item.addons.map((addon) => (
              <span key={addon.optionId} className="rounded-full bg-[#fff7ed] px-1.5 py-0.5 text-[9.5px] font-bold text-[#9a3412]">
                {addon.quantity && addon.quantity > 1 ? `${addon.quantity}× ` : ""}{addon.name}{addon.price > 0 ? ` +₹${(addon.price * (addon.quantity ?? 1)).toLocaleString("en-IN")}` : ""}
              </span>
            ))}
          </div>
        ) : null}
        {sellingUnits.length > 1 ? (
          <select
            aria-label={t("billing.cart.sellingUnitFor", { name: item.product.name })}
            disabled={guestLocked}
            value={item.sellingUnit?.unitCode ?? sellingUnits.find((unit) => unit.isDefault)?.unitCode ?? sellingUnits[0]?.unitCode}
            onChange={(event) => onUpdateUnit(lineKey, event.target.value)}
            className="mt-1 h-11 max-w-full rounded-md border border-[#dfe8f5] bg-white px-1.5 text-[10px] font-bold text-[#363C6B] outline-none focus:border-[var(--brand)]"
          >
            {sellingUnits.map((unit) => <option key={unit.unitCode} value={unit.unitCode}>{t("billing.cart.unitOption", { name: unit.name, price: Number(unit.defaultPrice).toLocaleString("en-IN") })}</option>)}
          </select>
        ) : item.sellingUnit ? (
          <p className="mt-1 inline-flex max-w-full items-center rounded-md border border-[#dfe8f5] bg-[var(--brand-softer)] px-1.5 py-1 text-[10px] font-bold text-[#363C6B]">
            {t("billing.cart.pack", { name: item.sellingUnit.name })}
          </p>
        ) : null}
        {canReadScale ? (
          <button
            type="button"
            onClick={() => onReadScale(lineKey, scaleUnit)}
            disabled={scaleReading}
            className="mt-1 inline-flex h-11 min-w-11 items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-1.5 text-[10px] font-extrabold text-emerald-700 transition hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-70"
            aria-label={t("billing.cart.readScaleFor", { name: item.product.name })}
          >
            {scaleReading ? <Loader2 size={11} className="animate-spin" /> : <Scale size={11} />}
            {scaleReading ? t("billing.cart.scaleReading") : t("billing.cart.useScale")}
          </button>
        ) : null}
        {editingRate ? (
          <div
            className={cn(
              "mt-1 inline-flex h-11 items-center gap-0.5 rounded-[7px] border bg-white px-1.5 shadow-sm ring-2 ring-offset-0",
              isBelowMin ? "border-red-300 ring-red-100" : "border-[var(--brand)] ring-[var(--brand)]/15",
            )}
          >
            <span className="text-[11px] font-bold text-[#98917F]">₹</span>
            <input
              ref={rateInputRef}
              data-testid={`rate-input-${item.product.id}`}
              type="number"
              inputMode="decimal"
              value={rateDraft}
              onChange={(e) => onRateDraftChange(e.target.value)}
              onBlur={commitRate}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitRate(); }
                if (e.key === "Escape") { setRateDraft(String(item.rate)); setEditingRate(false); }
              }}
              className="w-12 border-0 bg-transparent p-0 text-[12px] font-extrabold tabular-nums text-[#1B2145] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="whitespace-nowrap text-[11px] font-semibold text-[#98917F]">/{item.unit}</span>
          </div>
        ) : (
          <button
            data-testid={`rate-edit-${item.product.id}`}
            disabled={guestLocked}
            onClick={startEditRate}
            className={cn(
              "group mt-[5px] inline-flex min-h-11 items-center gap-1 rounded-[6px] px-1 py-[1px] text-[11px] font-bold leading-none -ml-1 transition-colors hover:bg-[#eef4ff]",
              isBelowMin ? "text-red-600" : "text-[#2d4268]",
            )}
            title={t("billing.cart.editRateHint")}
          >
            <span className="tabular-nums">
              ₹{item.rate.toLocaleString("en-IN")}/{item.unit}
              {addonUnitPrice(item.addons) > 0 ? ` + ₹${addonUnitPrice(item.addons).toLocaleString("en-IN")} options` : ""}
            </span>
            {isBelowMin ? <span className="font-semibold">{t("billing.cart.belowMin")}</span> : null}
            <Pencil size={10} className="text-[#9aa7bd] group-hover:text-[var(--brand)]" aria-hidden="true" />
          </button>
        )}
        {editingDiscount ? (
          <div className="mt-1 inline-flex h-11 items-center gap-0.5 rounded-[7px] border border-[var(--brand)] bg-white px-1.5 shadow-sm ring-2 ring-[var(--brand)]/15">
            <span className="text-[11px] font-bold text-[#98917F]">−₹</span>
            <input
              ref={discountInputRef}
              data-testid={`line-discount-input-${item.product.id}`}
              type="text"
              inputMode="decimal"
              value={discountDraft}
              onChange={(e) => setDiscountDraft(e.target.value)}
              onBlur={commitDiscount}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); commitDiscount(); }
                if (e.key === "Escape") { setEditingDiscount(false); }
              }}
              placeholder={t("billing.cart.discountPlaceholder")}
              className="w-14 border-0 bg-transparent p-0 text-[12px] font-extrabold tabular-nums text-[#1B2145] focus:outline-none"
            />
            <span className="whitespace-nowrap text-[10px] font-semibold text-[#98917F]">{t("billing.cart.offLineSuffix")}</span>
          </div>
        ) : lineDiscount > 0 ? (
          <button
            data-testid={`line-discount-edit-${item.product.id}`}
            disabled={guestLocked}
            onClick={startEditDiscount}
            className="mt-1 inline-flex min-h-11 items-center gap-1 rounded-[6px] bg-[#e9f9f0] px-1.5 py-[2px] text-[10px] font-extrabold leading-none text-[#1a8a4e] transition-colors hover:bg-[#d8f3e5]"
            title={t("billing.cart.editLineDiscountHint")}
          >
            <BadgePercent size={10} aria-hidden="true" />
            {t("billing.cart.lineDiscountApplied", { amount: lineDiscount.toLocaleString("en-IN") })}
          </button>
        ) : (
          <button
            data-testid={`line-discount-add-${item.product.id}`}
            disabled={guestLocked}
            onClick={startEditDiscount}
            className="group mt-1 inline-flex min-h-11 items-center gap-1 rounded-[6px] px-1 py-[1px] text-[10px] font-bold leading-none -ml-1 text-[#9aa7bd] transition-colors hover:bg-[#eef4ff] hover:text-[var(--brand)]"
            title={t("billing.cart.addLineDiscountHint")}
          >
            <BadgePercent size={10} aria-hidden="true" />
            {t("billing.cart.lineOff")}
          </button>
        )}
        <input
          data-testid={`line-note-input-${item.product.id}`}
          maxLength={200}
          value={item.note ?? ""}
          disabled={guestLocked}
          onChange={(event) => onUpdateLineNote(lineKey, event.target.value)}
          placeholder={t("billing.cart.notePlaceholder")}
          aria-label={t("billing.cart.noteFor", { name: item.product.name })}
          className="mt-1 h-11 w-full max-w-[220px] rounded-md border border-transparent bg-transparent px-1.5 text-[10px] font-semibold text-[#9a6b00] placeholder:text-[#9aa7bd] hover:bg-[#fff8e6] focus:border-[var(--brand)] focus:bg-white focus:outline-none"
        />
        {/* Batch-tracked goods only. A custom line has no product to draw batches from. */}
        {item.product.batchTrackingEnabled && !item.isCustom ? (
          <BatchPicker
            productId={item.product.id}
            productName={item.product.name}
            baseUnit={item.product.baseUnit ?? item.unit}
            selected={item.batch}
            onSelect={(batch) => onUpdateLineBatch(lineKey, batch)}
          />
        ) : null}
        {/* Smart Pricing explanation — why this rate (only when a rule beat the default). */}
        {!item.manualRate && !item.isCustom && item.pricing && item.pricing.appliedRuleType !== "DEFAULT_PRICE" ? (
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[10px] leading-tight" data-testid={`price-why-${item.product.id}`}>
            <span className="font-semibold text-[#1a8a4e]">{item.pricing.explanation}</span>
            {item.pricing.originalUnitPrice > item.rate + 0.005 ? (
              <span className="tabular-nums text-[#9aa7bd] line-through">₹{item.pricing.originalUnitPrice.toLocaleString("en-IN")}</span>
            ) : null}
            {item.pricing.requiresApproval ? <span className="font-bold text-red-600">{t("billing.cart.needsApproval")}</span> : null}
          </p>
        ) : null}
      </div>

      {/* Qty stepper — 84px, 3 columns */}
      <div className="col-start-2 row-start-2 grid h-[46px] w-[134px] grid-cols-3 justify-self-start overflow-hidden rounded-[8px] border border-[#dfe8f5] sm:col-auto sm:row-auto">
        <button
          data-testid={`button-dec-${item.product.id}`}
          disabled={guestLocked}
          onClick={() => onUpdateQty(lineKey, item.quantity - 1)}
          className="min-h-11 min-w-11 bg-white text-sm font-extrabold text-[#425679] hover:bg-[#FAF7F0]"
          aria-label={t("billing.cart.decrease", { name: item.product.name })}
        >
          −
        </button>
        <input
          data-testid={`qty-${item.product.id}`}
          disabled={guestLocked}
          type="number"
          inputMode="decimal"
          aria-label={t("billing.cart.quantityFor", { name: item.product.name })}
          {...qtyProps}
          className="min-h-11 min-w-11 border-x border-[#EAE4D8] bg-white text-center text-[12px] font-extrabold text-[#1B2145] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          data-testid={`button-inc-${item.product.id}`}
          disabled={guestLocked}
          onClick={() => onUpdateQty(lineKey, item.quantity + 1)}
          className="min-h-11 min-w-11 bg-white text-sm font-extrabold text-[#425679] hover:bg-[#FAF7F0]"
          aria-label={t("billing.cart.increase", { name: item.product.name })}
        >
          +
        </button>
      </div>

      {/* Line total (net of its own discount, with the gross struck through) */}
      <span className="col-start-3 row-start-2 self-center text-right text-[12px] font-black text-[#1B2145] tabular-nums sm:col-auto sm:row-auto">
        {lineDiscount > 0 ? (
          <span className="mr-1 text-[10px] font-semibold text-[#9aa7bd] line-through">₹{lineGross.toLocaleString("en-IN")}</span>
        ) : null}
        ₹{lineTotal.toLocaleString("en-IN")}
      </span>

      {/* Remove */}
      <button
        data-testid={`button-remove-${item.product.id}`}
        disabled={guestLocked}
        onClick={() => onRemoveItem(lineKey)}
        className="col-start-3 row-start-1 grid h-11 w-11 place-items-center rounded text-[#6B6455] transition-colors hover:bg-red-50 hover:text-red-600 sm:col-auto sm:row-auto"
        aria-label={t("billing.cart.remove", { name: item.product.name })}
      >
        <X size={15} />
      </button>
    </div>
  );
}
