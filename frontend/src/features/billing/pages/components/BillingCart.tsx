import { useState } from "react";
import { Input } from "@/components/ui/input";
import { ShoppingCart, X } from "lucide-react";
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
  const lineTotal = roundMoney(item.quantity * item.rate);
  const isBelowMin =
    !item.isCustom &&
    productMinSellingPrice(item.product) > 0 &&
    item.rate < productMinSellingPrice(item.product);
  const color = productPlaceholderColor(item.product.name);
  const emoji = getProductEmoji(item.product.name, item.product.category);

  return (
    <div
      data-testid={`cart-item-${item.product.id}`}
      className="grid grid-cols-[34px_1fr_84px_60px_22px] items-center gap-[9px] border-b border-[#edf1f6] px-2.5 py-3 last:border-b-0"
    >
      {/* Thumbnail */}
      <div className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg text-lg ${color}`}>
        {emoji}
      </div>

      {/* Name + rate */}
      <div className="min-w-0">
        <p className="truncate text-[12px] font-extrabold leading-[1.2] text-[#13274d]">
          {item.product.name}
        </p>
        <button
          onClick={() => setEditingRate((v) => !v)}
          className={cn(
            "mt-[5px] text-[11px] font-bold leading-none",
            editingRate
              ? "text-[#0057ff]"
              : isBelowMin
                ? "text-red-600"
                : "text-[#2d4268] hover:text-[#0057ff]",
          )}
        >
          {editingRate ? "✓ done" : `₹${item.rate}/${item.unit}${isBelowMin ? " · below min" : ""}`}
        </button>
        {editingRate && (
          <Input
            type="number"
            inputMode="decimal"
            value={item.rate}
            onChange={(e) => onUpdateRate(item.product.id, Number(e.target.value) || 0)}
            className="mt-1 h-7 w-20 px-2 text-xs font-semibold"
            placeholder="Rate ₹"
            autoFocus
          />
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
