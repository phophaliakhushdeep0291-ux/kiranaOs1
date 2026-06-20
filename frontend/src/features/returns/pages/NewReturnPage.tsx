import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, Plus, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { useListProducts } from "@/features/products/queries";
import { useListCustomers } from "@/features/customers/queries";
import { ReturnDialog, type ReturnLineInput } from "@/features/returns/components/ReturnDialog";
import type { Product } from "@/types/api";

function sellPrice(p: Product & Record<string, unknown>): number {
  const v = Number(p.defaultPricePerRateUnit ?? p.sellingPrice ?? p.mrp ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export default function NewReturnPage() {
  const products = useListProducts({ limit: 1000 });
  const customers = useListCustomers({ limit: 2000 });
  const [lines, setLines] = useState<ReturnLineInput[]>([]);
  const [productId, setProductId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);

  const productList = useMemo(() => (products.data ?? []) as Array<Product & Record<string, unknown>>, [products.data]);
  const customerList = customers.data ?? [];
  const selectedCustomer = customerList.find((c) => c.id === customerId);

  function addLine() {
    const product = productList.find((p) => p.id === productId);
    if (!product) return;
    setLines((prev) => [
      ...prev,
      {
        productId: product.id,
        name: product.name,
        soldQty: 0, // standalone: no original bill, so no cap
        enteredUnit: String(product.displayUnit ?? product.unit ?? product.rateUnit ?? "piece"),
        ratePerRateUnit: sellPrice(product),
        gstRate: Number(product.gstRate ?? 0),
      },
    ]);
    setProductId("");
  }

  return (
    <div className="space-y-4 p-4 lg:p-6">
      <div className="flex items-center gap-3">
        <Link href="/bills"><Button variant="outline" size="sm"><ArrowLeft size={15} className="mr-1" />Back</Button></Link>
        <div>
          <h1 className="text-xl font-black tracking-tight">New return</h1>
          <p className="text-sm text-muted-foreground">Return items not tied to a specific bill. For an exact refund, open the original bill and use “Return items”.</p>
        </div>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Items to return</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <div>
              <Label className="text-xs">Add product</Label>
              <select
                data-testid="return-product-select"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
                className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm"
              >
                <option value="">Select a product…</option>
                {productList.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} — ₹{sellPrice(p).toLocaleString("en-IN")}</option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <Button onClick={addLine} disabled={!productId}><Plus size={15} className="mr-1" />Add</Button>
            </div>
          </div>

          {lines.length === 0 ? (
            <p className="rounded-md border border-dashed p-3 text-sm text-muted-foreground">No items yet. Add products above.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {lines.map((line, i) => (
                <li key={`${line.productId}-${i}`} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span>{line.name} <span className="text-muted-foreground">· ₹{line.ratePerRateUnit.toLocaleString("en-IN")}/{line.enteredUnit}</span></span>
                  <button onClick={() => setLines((prev) => prev.filter((_, idx) => idx !== i))} className="text-rose-600 hover:text-rose-700"><Trash2 size={15} /></button>
                </li>
              ))}
            </ul>
          )}

          <div>
            <Label className="text-xs">Customer (optional — required to refund to udhar)</Label>
            <select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              className="mt-1 h-10 w-full rounded-lg border bg-background px-2 text-sm"
            >
              <option value="">Walk-in / no customer</option>
              {customerList.map((c) => (
                <option key={c.id} value={c.id}>{c.name}{c.mobile ? ` · ${c.mobile}` : ""}</option>
              ))}
            </select>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => setDialogOpen(true)} disabled={lines.length === 0}><RotateCcw size={15} className="mr-1" />Continue to refund</Button>
          </div>
        </CardContent>
      </Card>

      <ReturnDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        lines={lines}
        customerId={selectedCustomer?.id}
        customerName={selectedCustomer?.name}
        gstMode="inclusive"
        onDone={() => { setLines([]); setCustomerId(""); }}
      />
    </div>
  );
}
