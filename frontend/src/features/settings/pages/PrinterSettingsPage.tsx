import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useGetShop } from "@/lib/api/client";
import { Bluetooth, CheckCircle2, Cable, Download, FileText, Printer, RefreshCcw, Scale, Search, ShieldCheck, Usb, XCircle } from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, RowToggle } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";
import { DEFAULT_PRINTER_CONFIG, PRINTER_CONNECTION_LABELS, type PrinterConfig, type PrinterConnection } from "@/features/settings/printer-config";
import { buildReceiptHtml, openConfiguredReceiptWindow, type ReceiptPaperSize, type ReceiptSnapshot } from "@/features/receipts/receipt-print";
import { checkHardwareBridge, getHardwareBridgeToken, openCashDrawerViaHardwareBridge, readScaleViaHardwareBridge, setHardwareBridgeToken, type HardwareBridgeHealth } from "@/features/hardware/local-hardware-bridge";

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

type PrintJobStatus = "pending" | "sent" | "opened" | "failed" | "saved";

interface PrintJob {
  id: string;
  title: string;
  status: PrintJobStatus;
  time: string;
}

function nowTime() {
  return new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
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
  const [scanResult, setScanResult] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [bridgeToken, setBridgeToken] = useState(() => getHardwareBridgeToken());
  const [bridgeHealth, setBridgeHealth] = useState<HardwareBridgeHealth | null>(null);
  const [scaleReading, setScaleReading] = useState("");
  useEffect(() => { const t = setTimeout(() => setPreviewCfg(cfg), 300); return () => clearTimeout(t); }, [cfg]);
  const previewHtml = useMemo(() => buildReceiptHtml(sampleSnapshot(shop.data, previewCfg), { paperSize: previewCfg.paperSize, copies: 1 }), [shop.data, previewCfg]);
  const hardwareCapabilities = useMemo(() => {
    const browserNavigator = navigator as Navigator & { bluetooth?: unknown; usb?: unknown; serial?: unknown };
    return [
      { label: "System receipt printing", detail: "Print dialog and installed drivers", ready: typeof window.print === "function", icon: Printer },
      { label: "Bluetooth browser API", detail: "Detected only; printing still uses the paired system queue", ready: Boolean(browserNavigator.bluetooth) && window.isSecureContext, icon: Bluetooth },
      { label: "USB browser API", detail: "Detected only; direct ESC/POS uses the local bridge", ready: Boolean(browserNavigator.usb) && window.isSecureContext, icon: Usb },
      { label: "Serial weighing scale", detail: "Web Serial capable browser; device protocol still required", ready: Boolean(browserNavigator.serial) && window.isSecureContext, icon: Scale },
      { label: "Local hardware bridge", detail: bridgeHealth?.deviceName || "Direct printer, cutter, drawer and scale adapter", ready: Boolean(bridgeHealth?.ok), icon: Cable },
    ];
  }, [bridgeHealth]);

  function addJob(title: string, status: PrintJobStatus) {
    const id = `${Date.now()}-${Math.random()}`;
    setJobs((current) => [{ id, title, status, time: nowTime() }, ...current].slice(0, 8));
    return id;
  }

  function updateJob(id: string, status: PrintJobStatus) {
    setJobs((current) => current.map((job) => job.id === id ? { ...job, status, time: nowTime() } : job));
  }

  function testPrint() {
    let jobId = "";
    const direct = cfg.connection === "bridge";
    const ok = openConfiguredReceiptWindow(sampleSnapshot(shop.data, cfg), {
      paperSize: cfg.paperSize,
      copies: cfg.copies,
      autoPrint: true,
      onDirectPrintSettled: (result) => {
        if (jobId) updateJob(jobId, result.status === "sent" ? "sent" : "failed");
        if (result.status === "fallback") toast({ title: "Direct print not confirmed", description: result.message || "Inspect the printer before using the manual fallback.", variant: "destructive" });
      },
    });
    jobId = addJob("Sample receipt", ok ? (direct ? "pending" : "opened") : "failed");
    if (!ok) toast({ title: "Allow pop-ups", description: "Enable pop-ups to print the sample.", variant: "destructive" });
  }

  async function scanPrinters() {
    if (cfg.connection === "browser") {
      setScanResult("System print dialog is ready. Choose your printer from the dialog when printing.");
      toast({ title: "Browser printing ready", description: "The browser will show installed printers when you print." });
      return;
    }
    if (cfg.connection === "bluetooth") {
      setScanResult("Pair the printer in Windows or Android settings. It will then appear in the system print dialog; KiranaOS does not claim a direct Bluetooth printer protocol.");
      toast({ title: "Pair in device settings", description: "Then use Test Print to choose the paired queue." });
      return;
    }
    if (cfg.connection === "usb") {
      setScanResult("USB printers work through the operating system print dialog. Connect the printer, install the driver if needed, then print a sample.");
      toast({ title: "USB printer note", description: "Use Browser printing after the printer is installed." });
      return;
    }
    if (cfg.connection === "bridge") {
      try {
        setHardwareBridgeToken(bridgeToken);
        const health = await checkHardwareBridge(cfg.bridgeUrl);
        setBridgeHealth(health);
        if (!health.capabilities?.print) throw new Error("The local bridge is online, but no printer transport is configured.");
        setScanResult(`Connected to ${health.deviceName || "local hardware bridge"}${health.version ? ` · v${health.version}` : ""}.`);
        toast({ title: "Hardware bridge ready", description: "A direct printer transport was verified on this device." });
      } catch (error) {
        setBridgeHealth(null);
        setScanResult(error instanceof Error ? error.message : "Hardware bridge could not be reached.");
      }
      return;
    }
    setScanResult("Install the network printer as a system queue, then choose it in Test Print. For direct raw TCP printing, configure the local hardware bridge.");
    toast({ title: "Network printer", description: "Use the system queue or the direct local bridge." });
  }

  async function connectPrinter() {
    setConnecting(true);
    try {
      if (cfg.connection === "bridge") {
        if (bridgeToken.trim().length < 32) throw new Error("Use the bridge's random pairing token of at least 32 characters.");
        setHardwareBridgeToken(bridgeToken);
        const health = await checkHardwareBridge(cfg.bridgeUrl);
        setBridgeHealth(health);
        if (!health.capabilities?.print) throw new Error("The bridge is online, but its printer transport is not configured.");
      }
      await patch({ printer: cfg }, { immediate: true });
      setScanResult(`${PRINTER_CONNECTION_LABELS[cfg.connection]} saved as ${cfg.deviceName || "default printer"}.`);
      toast({ title: "Printer settings saved", description: "Bills will use this setup for print preview and printing." });
    } catch (error) {
      toast({ title: "Printer connection not ready", description: error instanceof Error ? error.message : "Check this printer setup.", variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  }

  async function setAsDefault() {
    await patch({ printer: { ...cfg, deviceName: cfg.deviceName.trim() || DEFAULT_PRINTER_CONFIG.deviceName } }, { immediate: true });
    toast({ title: "Default printer saved", description: `${cfg.deviceName || DEFAULT_PRINTER_CONFIG.deviceName} is now the billing printer.` });
  }

  async function testCashDrawer() {
    try {
      await openCashDrawerViaHardwareBridge(cfg.bridgeUrl);
      toast({ title: "Cash drawer opened", description: "The local bridge confirmed the drawer pulse." });
    } catch (error) { toast({ title: "Drawer test failed", description: error instanceof Error ? error.message : "Check the bridge and printer cable.", variant: "destructive" }); }
  }

  async function readScale() {
    try {
      const reading = await readScaleViaHardwareBridge(cfg.bridgeUrl);
      setScaleReading(`${reading.weight} ${reading.unit}`);
      toast({ title: "Scale reading received", description: `${reading.weight} ${reading.unit}` });
    } catch (error) { toast({ title: "Scale test failed", description: error instanceof Error ? error.message : "Check the bridge and scale protocol.", variant: "destructive" }); }
  }

  function downloadReceiptHtml() {
    const html = buildReceiptHtml(sampleSnapshot(shop.data, cfg), { paperSize: cfg.paperSize, copies: cfg.copies });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "kiranaos-sample-receipt.html";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addJob("Sample receipt downloaded", "saved");
    toast({ title: "Receipt downloaded", description: "Open it and choose Print / Save PDF." });
  }
  const systemQueueConnection = ["browser", "bluetooth", "usb", "network"].includes(cfg.connection);
  const connectionStatus = systemQueueConnection || (cfg.connection === "bridge" && bridgeHealth?.ok && bridgeHealth.capabilities?.print)
    ? "ready"
    : cfg.connection === "bridge" && bridgeToken.trim().length >= 32
      ? "configured"
      : "not_set";

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
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fld label="Printer name / label"><Input className="h-10" value={cfg.deviceName} onChange={(e) => setP("deviceName", e.target.value)} /></Fld>
                <Fld label="Printer model"><Input className="h-10" placeholder="e.g. TVS RP3160" value={cfg.model} onChange={(e) => setP("model", e.target.value)} /></Fld>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              {cfg.connection === "bridge" && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3"><Fld label="Local bridge URL" hint="Only localhost addresses are accepted."><Input className="h-10" value={cfg.bridgeUrl} onChange={(e) => setP("bridgeUrl", e.target.value)} placeholder="http://127.0.0.1:17873" /></Fld><Fld label="Per-device pairing token" hint="Stored only in this browser, never synced to the cloud."><Input type="password" className="h-10" value={bridgeToken} onChange={(event) => setBridgeToken(event.target.value)} placeholder="Pairing token from the bridge" /></Fld>{bridgeHealth?.ok ? <div className="flex flex-wrap items-center gap-2"><Button type="button" size="sm" variant="outline" onClick={() => void testCashDrawer()} disabled={!bridgeHealth.capabilities?.cashDrawer}>Test drawer</Button><Button type="button" size="sm" variant="outline" onClick={() => void readScale()} disabled={!bridgeHealth.capabilities?.scale}>Read scale</Button>{scaleReading ? <Badge tone="blue">Scale {scaleReading}</Badge> : null}</div> : null}</div>}
              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => void scanPrinters()}><Search size={14} /> Scan</Button>
                <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={() => void connectPrinter()} disabled={connecting}><Cable size={14} /> {connecting ? "Saving..." : "Connect"}</Button>
                <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={testPrint}><Printer size={14} /> Test Print</Button>
                <Button className="h-9 gap-1.5 rounded-[9px] text-[12px] font-black text-white" style={{ background: "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" }} onClick={() => void setAsDefault()}><CheckCircle2 size={14} /> Set Default</Button>
              </div>
              {scanResult ? <div className="rounded-[10px] border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-800">{scanResult}</div> : null}
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
              <RowToggle label="Cash drawer pulse" desc="Open the connected drawer after a direct bridge print" pill={cfg.connection === "bridge" ? <Switch checked={cfg.cashDrawer} onCheckedChange={(v) => setP("cashDrawer", v)} /> : <Badge tone="amber">Bridge required</Badge>} />
              <RowToggle label="Print logo" pill={<Switch checked={cfg.printLogo} onCheckedChange={(v) => setP("printLogo", v)} />} />
              <RowToggle label="Show dynamic UPI QR at checkout" desc="Uses the verified UPI ID saved in Store Profile" pill={<Switch checked={cfg.printQr} onCheckedChange={(v) => setP("printQr", v)} />} last />
            </div>
          </Card>
        </div>

        {/* Bill template preview */}
        <Card className="flex flex-col">
          <CardHead icon={<FileText size={15} />} title="Bill Template Preview" sub={`Live ${cfg.paperSize} receipt`} action={<button onClick={testPrint} className="text-[12px] font-bold text-[#005dff] hover:underline">Test print</button>} />
          <div className="flex-1 px-5 pb-5">
            <div className="app-table-scroll overflow-auto rounded-[12px] border border-[#e3e9f3] bg-[#eef1f6]">
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
            <Fld label="Footer note">
              <Input className="h-10" value={cfg.footerText} onChange={(e) => setP("footerText", e.target.value)} />
            </Fld>
            <p className="pt-2 text-[11px] text-[#9aa6bb]">Browser security allows direct printer scanning only for supported Bluetooth devices. For most thermal printers, install or pair the printer in Windows/Android and KiranaOS will print through the system dialog.</p>
          </div>
        </Card>

        {/* Printer queue / test */}
        <Card>
          <CardHead icon={<Printer size={15} />} title="Printer Queue" sub="Print actions from this session" action={<button onClick={() => { setJobs([]); toast({ title: "Queue cleared" }); }} className="text-[12px] font-bold text-[#005dff] hover:underline">Clear queue</button>} />
          <div className="px-5 pb-4">
            {jobs.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-[#dbe4f0] p-6 text-center text-[12px] font-semibold text-[#64748b]">
                No print jobs yet. Use Test Print or Download Receipt to check the setup.
              </div>
            ) : jobs.map((j, i) => (
              <div key={j.id} className={`flex items-center gap-3 py-2.5 ${i < jobs.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className={`grid h-8 w-8 place-items-center rounded-[8px] ${["sent", "opened", "saved"].includes(j.status) ? "bg-emerald-50 text-emerald-600" : j.status === "pending" ? "bg-blue-50 text-blue-600" : "bg-rose-50 text-rose-600"}`}>{j.status === "pending" ? <RefreshCcw size={15} className="animate-spin" /> : ["sent", "opened", "saved"].includes(j.status) ? <CheckCircle2 size={15} /> : <XCircle size={15} />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[#102347]">{j.title}</p>
                  <p className="text-[11px] text-[#64748b]">{j.time}</p>
                </div>
                {j.status === "failed" ? <Button size="sm" variant="outline" className="h-8 gap-1 rounded-[8px] text-[12px] font-bold" onClick={testPrint}><RefreshCcw size={12} /> Retry</Button> : <Badge tone={j.status === "pending" ? "blue" : "green"}>{j.status === "saved" ? "Saved" : j.status === "sent" ? "Sent to printer" : j.status === "opened" ? "Dialog opened" : "Sending"}</Badge>}
              </div>
            ))}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={testPrint}><Printer size={14} /> Print sample</Button>
              <Button variant="outline" className="h-9 gap-1.5 rounded-[9px] text-[12px] font-bold" onClick={downloadReceiptHtml}><Download size={14} /> Download receipt</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead icon={<ShieldCheck size={15} />} title="Hardware compatibility check" sub="Capabilities detected on this device—not marketing claims" />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-5">
          {hardwareCapabilities.map((capability) => {
            const Icon = capability.icon;
            return <div key={capability.label} className="rounded-xl border border-[#e5eaf2] bg-[#f8fafc] p-3"><div className="flex items-center justify-between"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[#075fff] shadow-sm"><Icon size={16} /></span><Badge tone={capability.ready ? "green" : "amber"}>{capability.ready ? "Available" : "Unavailable"}</Badge></div><p className="mt-3 text-[12px] font-black text-[#102347]">{capability.label}</p><p className="mt-1 text-[10.5px] leading-4 text-[#64748b]">{capability.detail}</p></div>;
          })}
        </div>
      </Card>
    </SettingsShell>
  );
}
