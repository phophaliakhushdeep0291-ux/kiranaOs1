import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react";
import {
  cartItemProfit,
  productCostPrice,
  productMinSellingPrice,
  productSellingPrice,
  profitClass,
} from "../billing-calculations";
import type { CartItem } from "../billing-types";
import { UNIT_OPTIONS } from "../billing-types";

interface BillingCartProps {
  cart: CartItem[];
  onUpdateQty: (productId: string, nextQuantity: number) => void;
  onUpdateRate: (productId: string, nextRate: number) => void;
  onUpdateUnit: (productId: string, unit: string) => void;
  onRemoveItem: (productId: string) => void;
}

export function BillingCart({ cart, onUpdateQty, onUpdateRate, onUpdateUnit, onRemoveItem }: BillingCartProps) {
  return (
    <ScrollArea className="flex-1 p-4">
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-black tracking-tight">Current bill</h2>
            <p className="text-xs text-muted-foreground">{cart.length} line item{cart.length === 1 ? "" : "s"}</p>
          </div>
        </div>

        {cart.length === 0 ? (
          <div className="premium-panel-muted flex min-h-72 flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <span className="grid h-14 w-14 place-items-center rounded-lg bg-primary/10 text-primary">
              <ShoppingCart size={26} aria-hidden="true" />
            </span>
            <p className="mt-4 text-base font-bold text-foreground">Ready for the next bill</p>
            <p className="mt-1 max-w-sm text-sm">Search a product above and add it to the cart.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {cart.map((item) => (
              <div
                key={item.product.id}
                data-testid={`cart-item-${item.product.id}`}
                className="premium-panel grid grid-cols-1 gap-3 p-3 xl:grid-cols-[minmax(0,1fr)_142px_150px_110px_130px_42px] xl:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{item.product.name}</p>
                  <p className="text-xs text-muted-foreground">{item.isCustom ? "Loose/custom item" : item.product.category ?? "Product"}</p>
                  {!item.isCustom ? (
                    <p className="text-[11px] text-muted-foreground">
                      Min Rs {productMinSellingPrice(item.product)} · Sell Rs {productSellingPrice(item.product, item.quantity)} · Cost Rs {productCostPrice(item.product)}
                    </p>
                  ) : null}
                </div>

                <div className="flex items-center gap-1">
                  <button
                    data-testid={`button-dec-${item.product.id}`}
                    onClick={() => onUpdateQty(item.product.id, item.quantity - 1)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background hover:bg-muted"
                    aria-label={`Decrease ${item.product.name}`}
                  >
                    <Minus size={13} />
                  </button>
                  <Input
                    data-testid={`qty-${item.product.id}`}
                    type="number"
                    inputMode="decimal"
                    value={item.quantity}
                    onChange={(event) => onUpdateQty(item.product.id, Number(event.target.value) || 0)}
                    className="h-10 text-center font-semibold"
                  />
                  <button
                    data-testid={`button-inc-${item.product.id}`}
                    onClick={() => onUpdateQty(item.product.id, item.quantity + 1)}
                    className="flex h-10 w-10 items-center justify-center rounded-lg border bg-background hover:bg-muted"
                    aria-label={`Increase ${item.product.name}`}
                  >
                    <Plus size={13} />
                  </button>
                </div>

                <div>
                  <Input
                    type="number"
                    inputMode="decimal"
                    value={item.rate}
                    onChange={(event) => onUpdateRate(item.product.id, Number(event.target.value) || 0)}
                    className="h-10 font-semibold"
                  />
                  {productMinSellingPrice(item.product) > 0 && item.rate < productMinSellingPrice(item.product) ? (
                    <p className="mt-1 text-[11px] text-destructive">Below minimum price</p>
                  ) : (
                    <p className="mt-1 text-[11px] text-muted-foreground">Rate</p>
                  )}
                </div>

                <Select value={item.unit} onValueChange={(unit) => onUpdateUnit(item.product.id, unit)}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{UNIT_OPTIONS.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
                </Select>

                <div className="text-right">
                  <span className="block text-sm font-black" data-testid={`line-total-${item.product.id}`}>
                    Rs {(item.quantity * item.rate).toLocaleString("en-IN")}
                  </span>
                  {!item.isCustom ? (
                    <span className={`text-[11px] font-semibold ${profitClass(cartItemProfit(item))}`}>
                      Profit Rs {cartItemProfit(item).toLocaleString("en-IN")}
                    </span>
                  ) : (
                    <span className="text-[11px] text-muted-foreground">Custom item</span>
                  )}
                </div>

                <button
                  data-testid={`button-remove-${item.product.id}`}
                  onClick={() => onRemoveItem(item.product.id)}
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  aria-label={`Remove ${item.product.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </ScrollArea>
  );
}
