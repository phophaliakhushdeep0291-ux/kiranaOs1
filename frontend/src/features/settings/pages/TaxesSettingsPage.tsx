import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { BarChart3, Boxes, Download, Pencil, Receipt, ShieldCheck } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, RowToggle, Kpi } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";

interface TaxConfig {
  mode: "exclusive" | "inclusive" | "none";
  defaultRate: string;
  gstin: string;
  invoicePrefix: string;
  taxInvoice: boolean;
  composition: boolean;
  rates: Record<string, boolean>;
  eInvoice: boolean;
  eWayBill: boolean;
  showBreakup: boolean;
  roundOff: boolean;
  lockAfterBill: boolean;
  warnInvalidGstin: boolean;
}
const DEFAULT_TAX: TaxConfig = {
  mode: "exclusive", defaultRate: "18", gstin: "", invoicePrefix: "INV",
  taxInvoice: true, composition: false,
  rates: { "0": true, "5": true, "12": true, "18": true, "28": true },
  eInvoice: false, eWayBill: false, showBreakup: true, roundOff: true, lockAfterBill: true, warnInvalidGstin: true,
};
const RATE_INFO: Record<string, string> = { "0": "Exempt / unbranded", "5": "Essentials", "12": "Processed foods", "18": "Standard", "28": "Luxury / sin" };
const HSN_ROWS = [
  { cat: "Packaged Food", rate: "5%", hsn: "1905", count: 124 },
  { cat: "Personal Care", rate: "18%", hsn: "3304", count: 42 },
  { cat: "Household", rate: "18%", hsn: "3402", count: 81 },
  { cat: "Beverages", rate: "12%", hsn: "2202", count: 36 },
];

export default function TaxesSettingsPage() {
  const { toast } = useToast();
  const { prefs, patch, shop, hydrated } = useSettingsPrefs();
  const [tax, setTax] = useState<TaxConfig>(DEFAULT_TAX);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !hydrated) return;
    seeded.current = true;
    const saved = (prefs.taxes ?? {}) as Partial<TaxConfig>;
    setTax({ ...DEFAULT_TAX, ...saved, rates: { ...DEFAULT_TAX.rates, ...(saved.rates ?? {}) }, gstin: saved.gstin ?? shop?.gstNumber ?? "" });
  }, [hydrated, prefs.taxes, shop]);

  const commit = (next: TaxConfig) => { setTax(next); patch({ taxes: next }); };
  const update = (partial: Partial<TaxConfig>) => commit({ ...tax, ...partial });
  const setText = (partial: Partial<TaxConfig>) => setTax((t) => ({ ...t, ...partial }));
  const flush = () => patch({ taxes: tax });

  return (
    <SettingsShell>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* GST Configuration */}
        <Card>
          <CardHead icon={<Receipt size={15} />} title="GST Configuration" sub="How tax applies to your bills" />
          <div className="space-y-3 px-5 pb-5">
            <Fld label="GST Mode" hint={tax.mode !== "none" ? "Changing mode after bills exist needs owner approval." : undefined}>
              <Select value={tax.mode} onValueChange={(v) => update({ mode: v as TaxConfig["mode"] })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No GST</SelectItem>
                  <SelectItem value="inclusive">Inclusive (tax in price)</SelectItem>
                  <SelectItem value="exclusive">Exclusive (add to price)</SelectItem>
                </SelectContent>
              </Select>
            </Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="Default GST Rate">
                <Select value={tax.defaultRate} onValueChange={(v) => update({ defaultRate: v })}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{["0", "5", "12", "18", "28"].map((r) => <SelectItem key={r} value={r}>{r}%</SelectItem>)}</SelectContent>
                </Select>
              </Fld>
              <Fld label="Invoice Prefix"><Input className="h-10" value={tax.invoicePrefix} onChange={(e) => setText({ invoicePrefix: e.target.value })} onBlur={flush} /></Fld>
            </div>
            <Fld label="Business GSTIN"><Input className="h-10" value={tax.gstin} onChange={(e) => setText({ gstin: e.target.value })} onBlur={flush} placeholder="22ABCDE1234F1Z5" /></Fld>
            <RowToggle label="Enable tax invoice" desc="Print GST invoices with breakup" pill={<Switch checked={tax.taxInvoice} onCheckedChange={(v) => update({ taxInvoice: v })} />} />
            <RowToggle label="Composition scheme" desc="Flat-rate dealers (no input credit)" pill={<Switch checked={tax.composition} onCheckedChange={(v) => update({ composition: v })} />} last />
          </div>
        </Card>

        {/* GST Rates */}
        <Card>
          <CardHead icon={<Receipt size={15} />} title="GST Rates" sub="Enable the slabs you sell at" />
          <div className="px-5 pb-4">
            {Object.keys(DEFAULT_TAX.rates).map((r, i, arr) => (
              <div key={r} className={`flex items-center gap-3 py-2.5 ${i < arr.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className="grid h-8 w-12 shrink-0 place-items-center rounded-[8px] bg-[#eef5ff] text-[13px] font-black text-[#005dff]">{r}%</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[#102347]">{RATE_INFO[r]}</p>
                  <p className="text-[11px] text-[#64748b]">{tax.defaultRate === r ? "Default rate" : "Tap to use on products"}</p>
                </div>
                {tax.defaultRate === r && <Badge tone="blue">Default</Badge>}
                <Switch checked={tax.rates[r] ?? false} onCheckedChange={(v) => update({ rates: { ...tax.rates, [r]: v } })} />
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* HSN / Product Mapping */}
      <Card>
        <CardHead icon={<Boxes size={15} />} title="HSN / Product Mapping" sub="GST rate & HSN code by category" action={<button onClick={() => toast({ title: "Bulk assign", description: "Assign HSN/GST to many products at once — coming with the catalog tools." })} className="text-[12px] font-bold text-[#005dff] hover:underline">Bulk assign</button>} />
        <div className="px-5 pb-5">
          <div className="overflow-hidden rounded-[10px] border border-[#eef2f8]">
            <table className="w-full text-[12px]">
              <thead className="bg-[#f7f9fd] text-[11px] uppercase tracking-wide text-[#64748b]">
                <tr>
                  <th className="px-3 py-2 text-left font-bold">Category</th>
                  <th className="px-3 py-2 text-left font-bold">GST Rate</th>
                  <th className="px-3 py-2 text-left font-bold">HSN Code</th>
                  <th className="px-3 py-2 text-left font-bold">Products</th>
                  <th className="px-3 py-2 text-right font-bold">Action</th>
                </tr>
              </thead>
              <tbody>
                {HSN_ROWS.map((row, i) => (
                  <tr key={row.cat} className={i < HSN_ROWS.length - 1 ? "border-b border-[#eef2f8]" : ""}>
                    <td className="px-3 py-2.5 font-bold text-[#102347]">{row.cat}</td>
                    <td className="px-3 py-2.5"><Badge tone="gray">{row.rate}</Badge></td>
                    <td className="px-3 py-2.5 font-mono text-[#344668]">{row.hsn}</td>
                    <td className="px-3 py-2.5 text-[#64748b]">{row.count} products</td>
                    <td className="px-3 py-2.5 text-right"><button onClick={() => toast({ title: `Edit ${row.cat}`, description: "Per-category HSN editing arrives with the catalog tools." })} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#005dff] hover:underline"><Pencil size={12} /> Edit</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* GST Reports */}
        <Card>
          <CardHead icon={<BarChart3 size={15} />} title="GST Reports" sub="This month" action={<button onClick={() => toast({ title: "Export started", description: "GST report export will download shortly." })} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#005dff] hover:underline"><Download size={12} /> Export</button>} />
          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            <Kpi label="GST Collected" value="₹18,430" tone="green" />
            <Kpi label="Taxable Sales" value="₹2,16,380" tone="blue" />
            <Kpi label="Output GST" value="₹18,430" tone="amber" />
            <Kpi label="Bills (GST)" value="124" tone="violet" />
          </div>
        </Card>

        {/* Compliance Settings */}
        <Card>
          <CardHead icon={<ShieldCheck size={15} />} title="Compliance Settings" sub="Accuracy & legal safeguards" />
          <div className="px-5 pb-4">
            <RowToggle label="E-Invoice" desc="Generate IRN for B2B invoices" pill={<Switch checked={tax.eInvoice} onCheckedChange={(v) => update({ eInvoice: v })} />} />
            <RowToggle label="E-Way Bill" desc="For goods movement" pill={<Switch checked={tax.eWayBill} onCheckedChange={(v) => update({ eWayBill: v })} />} />
            <RowToggle label="Show GST breakup on bill" pill={<Switch checked={tax.showBreakup} onCheckedChange={(v) => update({ showBreakup: v })} />} />
            <RowToggle label="Round off tax amount" pill={<Switch checked={tax.roundOff} onCheckedChange={(v) => update({ roundOff: v })} />} />
            <RowToggle label="Lock tax after bill creation" pill={<Switch checked={tax.lockAfterBill} onCheckedChange={(v) => update({ lockAfterBill: v })} />} />
            <RowToggle label="Warn if GSTIN invalid" pill={<Switch checked={tax.warnInvalidGstin} onCheckedChange={(v) => update({ warnInvalidGstin: v })} />} last />
          </div>
        </Card>
      </div>
    </SettingsShell>
  );
}
