import { useEffect, useRef, useState } from "react";
import { Pencil, ShoppingCart, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { productMinSellingPrice, roundMoney } from "../billing-calculations";
import type { CartItem } from "../billing-types";
import { getProductEmoji, productPlaceholderColor } from "./BillingSearch";

interface BillingCartProps {
  cart: CartItem[];
  onUpdateQty: (productId: string, nextQuantity: number) => void;
  onUpdateRate: (productId: string, nextRate: number) => void;
  onUpdateUnit: (productId: string, unit: string) => void;
  onRemoveItem: (productId: string) => void;
}

export function BillingCart({ cart, onUpdateQty, onUpdateRate, onRemoveItem }: BillingCartProps) {
  if (cart.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-10 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-[#f7f9fd] text-[#536383]">
          <ShoppingCart size={20} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-bold text-[#13274d]">Cart is empty</p>
          <p className="mt-0.5 text-xs text-[#536383]">Click products on the left to add</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      {cart.map((item) => (
        <CartRow
          key={item.product.id}
          item={item}
          onUpdateQty={onUpdateQty}
          onUpdateRate={onUpdateRate}
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
  onRemoveItem,
}: {
  item: CartItem;
  onUpdateQty: (id: string, qty: number) => void;
  onUpdateRate: (id: string, rate: number) => void;
  onRemoveItem: (id: string) => void;
}) {
  const [editingRate, setEditingRate] = useState(false);
  const [rateDraft, setRateDraft] = useState<string>(String(item.rate));
  const rateInputRef = useRef<HTMLInputElement | null>(null);
  const lineTotal = roundMoney(item.quantity * item.rate);
  const isBelowMin =
    !item.isCustom &&
    productMinSellingPrice(item.product) > 0 &&
    item.rate < productMinSellingPrice(item.product);
  const color = productPlaceholderColor(item.product.name);
  const emoji = getProductEmoji(item.product.name, item.product.category);

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
      onUpdateRate(item.product.id, parsed);
    }
  }

  function commitRate() {
    const parsed = Number(rateDraft);
    const safe = rateDraft.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 ? parsed : item.rate;
    onUpdateRate(item.product.id, safe);
    setRateDraft(String(safe));
    setEditingRate(false);
  }

  useEffect(() => {
    if (editingRate) {
      rateInputRef.current?.focus();
      rateInputRef.current?.select();
    }
  }, [editingRate]);

  return (
    <div
      data-testid={`cart-item-${item.product.id}`}
      className="grid grid-cols-[34px_1fr_84px_60px_22px] items-center gap-[9px] border-b border-[#edf1f6] px-2.5 py-3 last:border-b-0"
    >
      {/* Thumbnail */}
      <div className={`grid h-[34px] w-[34px] shrink-0 place-items-center overflow-hidden rounded-[7px] text-lg ${color}`}>
        {item.product.imageUrl ? <img src={item.product.imageUrl} alt="" className="h-full w-full object-contain" /> : emoji}
      </div>

      {/* Name + editable rate */}
      <div className="min-w-0">
        <p className="truncate text-[12px] font-extrabold leading-[1.2] text-[#13274d]">
          {item.product.name}
        </p>
        {editingRate ? (
          <div
            className={cn(
              "mt-1 inline-flex h-[26px] items-center gap-0.5 rounded-[7px] border bg-white px-1.5 shadow-sm ring-2 ring-offset-0",
              isBelowMin ? "border-red-300 ring-red-100" : "border-[#0057ff] ring-[#0057ff]/15",
            )}
          >
            <span className="text-[11px] font-bold text-[#8290a8]">₹</span>
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
              className="w-12 border-0 bg-transparent p-0 text-[12px] font-extrabold tabular-nums text-[#13274d] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="whitespace-nowrap text-[11px] font-semibold text-[#8290a8]">/{item.unit}</span>
          </div>
        ) : (
          <button
            data-testid={`rate-edit-${item.product.id}`}
            onClick={startEditRate}
            className={cn(
              "group mt-[5px] inline-flex items-center gap-1 rounded-[6px] px-1 py-[1px] text-[11px] font-bold leading-none -ml-1 transition-colors hover:bg-[#eef4ff]",
              isBelowMin ? "text-red-600" : "text-[#2d4268]",
            )}
            title="Tap to change rate per unit"
          >
            <span className="tabular-nums">₹{item.rate.toLocaleString("en-IN")}/{item.unit}</span>
            {isBelowMin ? <span className="font-semibold">· below min</span> : null}
            <Pencil size={10} className="text-[#9aa7bd] group-hover:text-[#0057ff]" aria-hidden="true" />
          </button>
        )}
      </div>

      {/* Qty stepper — 84px, 3 columns */}
      <div className="grid h-[30px] w-[84px] grid-cols-3 overflow-hidden rounded-[8px] border border-[#dfe8f5]">
        <button
          data-testid={`button-dec-${item.product.id}`}
          onClick={() => onUpdateQty(item.product.id, item.quantity - 1)}
          className="bg-white text-sm font-extrabold text-[#425679] hover:bg-[#f7f9fd]"
          aria-label={`Decrease ${item.product.name}`}
        >
          −
        </button>
        <input
          data-testid={`qty-${item.product.id}`}
          type="number"
          inputMode="decimal"
          value={item.quantity}
          onChange={(e) => onUpdateQty(item.product.id, Number(e.target.value) || 0)}
          className="border-x border-[#e6ecf4] bg-white text-center text-[12px] font-extrabold text-[#13274d] focus:outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          data-testid={`button-inc-${item.product.id}`}
          onClick={() => onUpdateQty(item.product.id, item.quantity + 1)}
          className="bg-white text-sm font-extrabold text-[#425679] hover:bg-[#f7f9fd]"
          aria-label={`Increase ${item.product.name}`}
        >
          +
        </button>
      </div>

      {/* Line total */}
      <span className="text-right text-[12px] font-black text-[#13274d] tabular-nums">
        ₹{lineTotal.toLocaleString("en-IN")}
      </span>

      {/* Remove */}
      <button
        data-testid={`button-remove-${item.product.id}`}
        onClick={() => onRemoveItem(item.product.id)}
        className="grid h-[22px] w-[22px] place-items-center rounded text-[#536383] transition-colors hover:bg-red-50 hover:text-red-600"
        aria-label={`Remove ${item.product.name}`}
      >
        <X size={15} />
      </button>
    </div>
  );
}
