import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Minus, Plus, ShoppingCart } from "lucide-react";
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
      <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-xl bg-muted text-muted-foreground">
          <ShoppingCart size={20} aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-foreground">Cart is empty</p>
          <p className="mt-0.5 text-xs text-muted-foreground">Click products on the left to add</p>
        </div>
      </div>
    );
  }

  return (
    <div className="divide-y">
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
      className="flex items-center gap-2.5 px-1 py-2.5"
    >
      {/* Thumbnail */}
      <div
        className={`grid h-10 w-10 shrink-0 place-items-center rounded-lg text-xl ${color}`}
      >
        {emoji}
      </div>

      {/* Name + rate */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold leading-tight">{item.product.name}</p>
        <button
          onClick={() => setEditingRate((v) => !v)}
          className={cn(
            "mt-0.5 text-xs leading-none",
            editingRate
              ? "font-semibold text-primary"
              : isBelowMin
                ? "font-semibold text-destructive"
                : "text-muted-foreground hover:text-foreground",
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

      {/* Qty controls */}
      <div className="flex shrink-0 items-center gap-1">
        <button
          data-testid={`button-dec-${item.product.id}`}
          onClick={() => onUpdateQty(item.product.id, item.quantity - 1)}
          className="grid h-7 w-7 place-items-center rounded-lg border bg-background text-sm hover:bg-muted"
          aria-label={`Decrease ${item.product.name}`}
        >
          <Minus size={11} />
        </button>
        <Input
          data-testid={`qty-${item.product.id}`}
          type="number"
          inputMode="decimal"
          value={item.quantity}
          onChange={(e) => onUpdateQty(item.product.id, Number(e.target.value) || 0)}
          className="h-7 w-12 px-1 text-center text-sm font-semibold"
        />
        <button
          data-testid={`button-inc-${item.product.id}`}
          onClick={() => onUpdateQty(item.product.id, item.quantity + 1)}
          className="grid h-7 w-7 place-items-center rounded-lg border bg-background text-sm hover:bg-muted"
          aria-label={`Increase ${item.product.name}`}
        >
          <Plus size={11} />
        </button>
      </div>

      {/* Line total + remove */}
      <div className="flex shrink-0 items-center gap-1">
        <span className="min-w-[52px] text-right text-sm font-black tabular-nums">
          ₹{lineTotal.toLocaleString("en-IN")}
        </span>
        <button
          data-testid={`button-remove-${item.product.id}`}
          onClick={() => onRemoveItem(item.product.id)}
          className="grid h-6 w-6 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          aria-label={`Remove ${item.product.name}`}
        >
          ✕
        </button>
      </div>
    </div>
  );
}
