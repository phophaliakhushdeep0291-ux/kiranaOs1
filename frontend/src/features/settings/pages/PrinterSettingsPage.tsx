import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useGetShop } from "@/lib/api/client";
import { CheckCircle2, Cable, Download, FileText, Printer, RefreshCcw, Wifi, XCircle } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";
import { DEFAULT_PRINTER_CONFIG, PRINTER_CONNECTION_LABELS, type PrinterConfig, type PrinterConnection } from "@/features/settings/printer-config";
import { buildReceiptHtml, openReceiptWindow, type ReceiptPaperSize, type ReceiptSnapshot } from "@/features/receipts/receipt-print";

function sampleSnapshot(shop: ReturnType<typeof useGetShop>["data"], cfg: PrinterConfig): ReceiptSnapshot {
  return {
    billNo: "PREVIEW-001",
    createdAt: new Date().toISOString(),
    billTypeLabel: "Sample receipt",
    copyLabel: cfg.customerCopy ? "Customer copy" : "Shop copy",
    customerName: "Walk-in customer",
    customerMobile: cfg.showCustomerPhone ? "9876543210" : "",
    rows: [
      { name: "Tata Salt 1kg", quantity: 2, unit: "pkt", rate: 28, total: 56 },
      { name: "Aashirvaad Atta 5kg", quantity: 1, unit: "bag", rate: 245, total: 245 },
      { name: "Amul Butter 100g", quantity: 3, unit: "pcs", rate: 62, total: 186 },
    ],
    subtotal: 487, discount: cfg.showDiscount ? 7 : 0, total: 480, paid: 480, credit: 0,
    payments: [{ mode: "cash", amount: 480 }],
    shop: {
      name: shop?.name ?? "My Store",
      address: shop?.address ?? null,
      city: shop?.city ?? null,
      phone: shop?.phone ?? null,
      gstNumber: cfg.showGst ? (shop?.gstNumber ?? null) : null,
      cashierName: cfg.showCashier ? "Counter 1" : null,
    },
    footerNote: cfg.footerText || "Thank you for shopping with us.",
  };
}

export default function PrinterSettingsPage() {
  const { toast } = useToast();
  const shop = useGetShop();
  const { prefs, patch } = useSettingsPrefs();
  // Stable per saved-printer reference so the preview useMemo actually caches.
  const cfg: PrinterConfig = useMemo(() => ({ ...DEFAULT_PRINTER_CONFIG, ...(prefs.printer ?? {}) }), [prefs.printer]);

  const setP = <K extends keyof PrinterConfig>(key: K, val: PrinterConfig[K]) => patch({ printer: { ...cfg, [key]: val } });

  // Debounce the receipt rebuild so rapid typing/toggling doesn't reload the iframe each keystroke.
  const [previewCfg, setPreviewCfg] = useState(cfg);
  useEffect(() => { const t = setTimeout(() => setPreviewCfg(cfg), 300); return () => clearTimeout(t); }, [cfg]);
  const previewHtml = useMemo(() => buildReceiptHtml(sampleSnapshot(shop.data, previewCfg), { paperSize: previewCfg.paperSize, copies: 1 }), [shop.data, previewCfg]);

  function testPrint() {
    const ok = openReceiptWindow(sampleSnapshot(shop.data, cfg), { paperSize: cfg.paperSize, copies: cfg.copies, autoPrint: true });
    if (!ok) toast({ title: "Allow pop-ups", description: "Enable pop-ups to print the sample.", variant: "destructive" });
  }
  const connectionStatus = cfg.connection === "browser" ? "ready" : cfg.networkAddress || cfg.model ? "configured" : "not_set";

  return (
    <SettingsShell>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Default printer setup */}
        <div className="space-y-4">
          <Card>
            <CardHead icon={<Printer size={15} />} title="Default Printer Setup" sub="Connect your receipt printer" action={connectionStatus === "ready" ? <Badge tone="green"><CheckCircle2 size={11} /> Ready</Badge> : connectionStatus === "configured" ? <Badge tone="blue">Configured</Badge> : <Badge tone="amber">Not set</Badge>} />
            <div className="space-y-3 px-5 pb-5">
              <Fld label="Connection type">
                <Select value={cfg.connection} onValueChange={(v) => setP("connection", v as PrinterConnection)}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.entries(PRINTER_CONNECTION_LABELS) as [PrinterConnection, string][]).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Fld>
              <div className="grid grid-cols-2 gap-3">
                <Fld label="Printer name / label"><Input className="h-10" value={cfg.deviceName} onChange={(e) => setP("deviceName", e.target.value)} /></Fld>
                <Fld label="Printer model"><Input className="h-10" placeholder="e.g. TVS RP3160" value={cfg.model} onChange={(e) => setP("model", e.target.value)} /></Fld>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Fld label="Paper size">
                  <Select value={cfg.paperSize} onValueChange={(v) => setP("paperSize", v as ReceiptPaperSize)}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="58mm">58mm thermal</SelectItem><SelectItem value="80mm">80mm thermal</SelectItem><SelectItem value="A4">A4 sheet</SelectItem></SelectContent>
                  </Select>
                </Fld>
                <Fld label="Copies per bill">
                  <Select value={String(cfg.copies)} onValueChange={(v) => setP("copies", Number(v))}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>{[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                </Fld>
              </div>
              {cfg.connection === "network" && <Fld label="Network address (IP:port)"><Input className="h-10" placeholder="192.168.1.50:9100" value={cfg.networkAddress} onChange={(e) => setP("networkAddress", e.target.value)} /></Fld>}
              <div className="grid grid-cols-2 gap-2 pt-1">
                <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => toast({ title: "Scanning for printers…", description: cfg.connection === "browser" ? "Browser printing uses your system dialog." : "Pair the printer from your device first." })}><Wifi size={14} /> Scan</Button>
                <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => toast({ title: "Connection saved", description: PRINTER_CONNECTION_LABELS[cfg.connection] })}><Cable size={14} /> Connect</Button>
                <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={testPrint}><Printer size={14} /> Test Print</Button>
                <Button className="h-9 gap-1.5 rounded-[9px] text-[12px] font-black text-white" style={{ background: "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" }} onClick={() => toast({ title: "Set as default printer" })}><CheckCircle2 size={14} /> Set Default</Button>
              </div>
            </div>
          </Card>

          {/* Print settings */}
          <Card>
            <CardHead icon={<Printer size={15} />} title="Print Settings" sub="What happens when a bill is saved" />
            <div className="px-5 pb-4">
              <RowToggle label="Auto-print after billing" desc="Open the receipt as soon as a bill is saved" pill={<Switch checked={cfg.autoPrint} onCheckedChange={(v) => setP("autoPrint", v)} />} />
              <RowToggle label="Ask before printing" desc="Confirm each print" pill={<Switch checked={cfg.askBeforePrint} onCheckedChange={(v) => setP("askBeforePrint", v)} />} />
              <RowToggle label="Print customer copy" pill={<Switch checked={cfg.customerCopy} onCheckedChange={(v) => setP("customerCopy", v)} />} />
              <RowToggle label="Print shop copy" pill={<Switch checked={cfg.shopCopy} onCheckedChange={(v) => setP("shopCopy", v)} />} />
              <RowToggle label="Auto cut paper" desc="Supported thermal printers" pill={<Switch checked={cfg.autoCut} onCheckedChange={(v) => setP("autoCut", v)} />} />
              <RowToggle label="Open cash drawer after bill" pill={<Switch checked={cfg.cashDrawer} onCheckedChange={(v) => setP("cashDrawer", v)} />} />
              <RowToggle label="Print logo" pill={<Switch checked={cfg.printLogo} onCheckedChange={(v) => setP("printLogo", v)} />} />
              <RowToggle label="Print payment QR code" pill={<Switch checked={cfg.printQr} onCheckedChange={(v) => setP("printQr", v)} />} last />
            </div>
          </Card>
        </div>

        {/* Bill template preview */}
        <Card className="flex flex-col">
          <CardHead icon={<FileText size={15} />} title="Bill Template Preview" sub={`Live ${cfg.paperSize} receipt`} action={<button onClick={testPrint} className="text-[12px] font-bold text-[#005dff] hover:underline">Test print</button>} />
          <div className="flex-1 px-5 pb-5">
            <div className="overflow-hidden rounded-[12px] border border-[#e3e9f3] bg-[#eef1f6]">
              <iframe title="Receipt preview" srcDoc={previewHtml} className="h-[560px] w-full border-0" />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bill content settings */}
        <Card>
          <CardHead icon={<FileText size={15} />} title="Bill Content Settings" sub="Which details appear on the receipt" />
          <div className="px-5 pb-4">
            <RowToggle label="Show MRP" pill={<Switch checked={cfg.showMrp} onCheckedChange={(v) => setP("showMrp", v)} />} />
            <RowToggle label="Show discount" pill={<Switch checked={cfg.showDiscount} onCheckedChange={(v) => setP("showDiscount", v)} />} />
            <RowToggle label="Show GST breakup" pill={<Switch checked={cfg.showGstBreakup} onCheckedChange={(v) => setP("showGstBreakup", v)} />} />
            <RowToggle label="Show HSN code" pill={<Switch checked={cfg.showHsn} onCheckedChange={(v) => setP("showHsn", v)} />} />
            <RowToggle label="Show cashier name" pill={<Switch checked={cfg.showCashier} onCheckedChange={(v) => setP("showCashier", v)} />} />
            <RowToggle label="Show customer phone" pill={<Switch checked={cfg.showCustomerPhone} onCheckedChange={(v) => setP("showCustomerPhone", v)} />} />
            <RowToggle label="Show previous udhar" pill={<Switch checked={cfg.showPreviousUdhar} onCheckedChange={(v) => setP("showPreviousUdhar", v)} />} />
            <RowToggle label="Show total savings" pill={<Switch checked={cfg.showSavings} onCheckedChange={(v) => setP("showSavings", v)} />} />
            <RowToggle label="Show return policy" pill={<Switch checked={cfg.showReturnPolicy} onCheckedChange={(v) => setP("showReturnPolicy", v)} />} last />
            <p className="pt-2 text-[11px] text-[#9aa6bb]">Paper size, copies, GSTIN, cashier & footer apply to the printed bill now; the remaining fields are saved and roll out to the receipt template.</p>
          </div>
        </Card>

        {/* Printer queue / test */}
        <Card>
          <CardHead icon={<Printer size={15} />} title="Printer Queue" sub="Recent print jobs" action={<button onClick={() => toast({ title: "Queue cleared" })} className="text-[12px] font-bold text-[#005dff] hover:underline">Clear queue</button>} />
          <div className="px-5 pb-4">
            {[
              { bill: "#1023", status: "printed", time: "11:42 AM" },
              { bill: "#1022", status: "failed", time: "11:36 AM" },
              { bill: "#1021", status: "printed", time: "11:30 AM" },
            ].map((j, i) => (
              <div key={j.bill} className={`flex items-center gap-3 py-2.5 ${i < 2 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className={`grid h-8 w-8 place-items-center rounded-[8px] ${j.status === "printed" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600"}`}>{j.status === "printed" ? <CheckCircle2 size={15} /> : <XCircle size={15} />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[#102347]">Bill {j.bill}</p>
                  <p className="text-[11px] text-[#64748b]">{j.time}</p>
                </div>
                {j.status === "printed" ? <Badge tone="green">Printed</Badge> : <Button size="sm" variant="outline" className="h-8 gap-1 rounded-[8px] text-[12px] font-bold" onClick={testPrint}><RefreshCcw size={12} /> Retry</Button>}
              </div>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={testPrint}><Printer size={14} /> Print sample</Button>
              <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={testPrint}><Download size={14} /> Download PDF</Button>
            </div>
          </div>
        </Card>
      </div>
    </SettingsShell>
  );
}
