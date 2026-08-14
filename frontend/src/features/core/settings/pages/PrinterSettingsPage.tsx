import { useAppLanguage } from "@/features/core/settings/i18n";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useGetShop } from "@/lib/api/client";
import { Bluetooth, CheckCircle2, Cable, Download, FileText, Monitor, Printer, RefreshCcw, Scale, Search, ShieldCheck, Usb, XCircle } from "lucide-react";
import { SettingsShell } from "@/features/core/settings/SettingsShell";
import { Card, CardHead, Fld, Badge, RowToggle } from "@/features/core/settings/ui";
import { useSettingsPrefs } from "@/features/core/settings/use-settings-prefs";
import { DEFAULT_PRINTER_CONFIG, PRINTER_CONNECTION_LABELS, type PrinterConfig, type PrinterConnection } from "@/features/core/settings/printer-config";
import { buildReceiptHtml, openConfiguredReceiptWindow, type ReceiptPaperSize } from "@/features/core/receipts/receipt-print";
import { sampleReceiptSnapshot } from "@/features/core/settings/receipt-preview-sample";
import { checkHardwareBridge, getHardwareBridgeToken, openCashDrawerViaHardwareBridge, pairHardwareBridge, readScaleViaHardwareBridge, showCustomerDisplayViaHardwareBridge, type HardwareBridgeHealth } from "@/features/core/hardware/local-hardware-bridge";

const sampleSnapshot = sampleReceiptSnapshot;

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
  const { t } = useAppLanguage();
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
  const [pairingCode, setPairingCode] = useState("");
  const [bridgePaired, setBridgePaired] = useState(() => Boolean(getHardwareBridgeToken()));
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
      { label: "Customer display", detail: bridgeHealth?.capabilities?.customerDisplay ? "Paired structured-total adapter" : "Configure a vendor adapter in Hardware Bridge Setup", ready: Boolean(bridgeHealth?.capabilities?.customerDisplay), icon: Monitor },
      { label: "Local hardware bridge", detail: bridgeHealth?.deviceName || "Direct printer, cutter, drawer, scale and display adapters", ready: Boolean(bridgeHealth?.ok), icon: Cable },
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
        if (result.status === "fallback") toast({ title: t("settings.printer.directNotConfirmed"), description: result.message || "Inspect the printer before using the manual fallback.", variant: "destructive" });
      },
    });
    jobId = addJob("Sample receipt", ok ? (direct ? "pending" : "opened") : "failed");
    if (!ok) toast({ title: t("settings.printer.allowPopups"), description: t("settings.printer.allowPopupsHelp"), variant: "destructive" });
  }

  async function scanPrinters() {
    if (cfg.connection === "browser") {
      setScanResult("System print dialog is ready. Choose your printer from the dialog when printing.");
      toast({ title: t("settings.printer.browserReady"), description: t("settings.printer.browserReadyHelp") });
      return;
    }
    if (cfg.connection === "bluetooth") {
      setScanResult("Pair the printer in Windows or Android settings. It will then appear in the system print dialog; Artha does not claim a direct Bluetooth printer protocol.");
      toast({ title: t("settings.printer.pairInSettings"), description: t("settings.printer.pairInSettingsHelp") });
      return;
    }
    if (cfg.connection === "usb") {
      setScanResult("USB printers work through the operating system print dialog. Connect the printer, install the driver if needed, then print a sample.");
      toast({ title: t("settings.printer.usbNote"), description: t("settings.printer.usbNoteHelp") });
      return;
    }
    if (cfg.connection === "bridge") {
      try {
        const health = await checkHardwareBridge(cfg.bridgeUrl);
        setBridgeHealth(health);
        if (!health.capabilities?.print) throw new Error(t("settings.printer.noTransport"));
        setScanResult(`Connected to ${health.deviceName || "local hardware bridge"}${health.version ? ` · v${health.version}` : ""}.`);
        toast({ title: t("settings.printer.bridgeReady"), description: t("settings.printer.bridgeReadyHelp") });
      } catch (error) {
        setBridgeHealth(null);
        setScanResult(error instanceof Error ? error.message : "Hardware bridge could not be reached.");
      }
      return;
    }
    setScanResult("Install the network printer as a system queue, then choose it in Test Print. For direct raw TCP printing, configure the local hardware bridge.");
    toast({ title: t("settings.printer.networkPrinter"), description: t("settings.printer.networkPrinterHelp") });
  }

  async function connectPrinter() {
    setConnecting(true);
    try {
      if (cfg.connection === "bridge") {
        const health = pairingCode.trim()
          ? await pairHardwareBridge(cfg.bridgeUrl, pairingCode)
          : await checkHardwareBridge(cfg.bridgeUrl);
        setBridgeHealth(health);
        setBridgePaired(true);
        setPairingCode("");
        if (!health.capabilities?.print) throw new Error(t("settings.printer.transportNotConfigured"));
      }
      await patch({ printer: cfg }, { immediate: true });
      setScanResult(`${PRINTER_CONNECTION_LABELS[cfg.connection]} saved as ${cfg.deviceName || "default printer"}.`);
      toast({ title: t("settings.printer.settingsSaved"), description: t("settings.printer.settingsSavedHelp") });
    } catch (error) {
      toast({ title: t("settings.printer.connectionNotReady"), description: error instanceof Error ? error.message : "Check this printer setup.", variant: "destructive" });
    } finally {
      setConnecting(false);
    }
  }

  async function setAsDefault() {
    await patch({ printer: { ...cfg, deviceName: cfg.deviceName.trim() || DEFAULT_PRINTER_CONFIG.deviceName } }, { immediate: true });
    toast({ title: t("settings.printer.defaultSaved"), description: `${cfg.deviceName || DEFAULT_PRINTER_CONFIG.deviceName} is now the billing printer.` });
  }

  async function testCashDrawer() {
    try {
      await openCashDrawerViaHardwareBridge(cfg.bridgeUrl);
      toast({ title: t("settings.printer.drawerOpened"), description: t("settings.printer.drawerOpenedHelp") });
    } catch (error) { toast({ title: t("settings.printer.drawerFailed"), description: error instanceof Error ? error.message : "Check the bridge and printer cable.", variant: "destructive" }); }
  }

  async function readScale() {
    try {
      const reading = await readScaleViaHardwareBridge(cfg.bridgeUrl);
      setScaleReading(`${reading.weight} ${reading.unit}`);
      toast({ title: t("settings.printer.scaleReceived"), description: `${reading.weight} ${reading.unit}` });
    } catch (error) { toast({ title: t("settings.printer.scaleFailed"), description: error instanceof Error ? error.message : "Check the bridge and scale protocol.", variant: "destructive" }); }
  }

  async function testCustomerDisplay() {
    try {
      await showCustomerDisplayViaHardwareBridge(cfg.bridgeUrl, {
        revision: Date.now(),
        state: "sale",
        itemCount: 2,
        totalPaise: 12_345,
      });
      toast({ title: t("settings.printer.displayUpdated"), description: t("settings.printer.displayUpdatedHelp") });
    } catch (error) { toast({ title: t("settings.printer.displayFailed"), description: error instanceof Error ? error.message : "Check the bridge and display adapter.", variant: "destructive" }); }
  }

  function downloadReceiptHtml() {
    const html = buildReceiptHtml(sampleSnapshot(shop.data, cfg), { paperSize: cfg.paperSize, copies: cfg.copies });
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "artha-sample-receipt.html";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    addJob("Sample receipt downloaded", "saved");
    toast({ title: t("settings.printer.receiptDownloaded"), description: t("settings.printer.receiptDownloadedHelp") });
  }
  const systemQueueConnection = ["browser", "bluetooth", "usb", "network"].includes(cfg.connection);
  const connectionStatus = systemQueueConnection || (cfg.connection === "bridge" && bridgeHealth?.ok && bridgeHealth.capabilities?.print)
    ? "ready"
    : cfg.connection === "bridge" && bridgePaired
      ? "configured"
      : "not_set";

  return (
    <SettingsShell>
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Default printer setup */}
        <div className="space-y-4">
          <Card>
            <CardHead icon={<Printer size={15} />} title={t("settings.printer.setupTitle")} sub={t("settings.printer.setupSub")} action={connectionStatus === "ready" ? <Badge tone="green"><CheckCircle2 size={11} /> {t("settings.printer.ready")}</Badge> : connectionStatus === "configured" ? <Badge tone="blue">{t("settings.printer.configured")}</Badge> : <Badge tone="amber">{t("settings.security.notSet")}</Badge>} />
            <div className="space-y-3 px-5 pb-5">
              <Fld label={t("settings.printer.connectionType")}>
                <Select value={cfg.connection} onValueChange={(v) => setP("connection", v as PrinterConnection)}>
                  <SelectTrigger className="h-11 sm:mouse:h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>{(Object.entries(PRINTER_CONNECTION_LABELS) as [PrinterConnection, string][]).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}</SelectContent>
                </Select>
              </Fld>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fld label={t("settings.printer.printerName")}><Input className="h-11 sm:mouse:h-10" value={cfg.deviceName} onChange={(e) => setP("deviceName", e.target.value)} /></Fld>
                <Fld label={t("settings.printer.printerModel")}><Input className="h-11 sm:mouse:h-10" placeholder={t("settings.printer.printerModelPlaceholder")} value={cfg.model} onChange={(e) => setP("model", e.target.value)} /></Fld>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Fld label={t("settings.printer.paperSize")}>
                  <Select value={cfg.paperSize} onValueChange={(v) => setP("paperSize", v as ReceiptPaperSize)}>
                    <SelectTrigger className="h-11 sm:mouse:h-10"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="58mm">{t("settings.printer.paper58")}</SelectItem><SelectItem value="80mm">{t("settings.printer.paper80")}</SelectItem><SelectItem value="A4">{t("settings.printer.paperA4")}</SelectItem></SelectContent>
                  </Select>
                </Fld>
                <Fld label={t("settings.printer.copiesPerBill")}>
                  <Select value={String(cfg.copies)} onValueChange={(v) => setP("copies", Number(v))}>
                    <SelectTrigger className="h-11 sm:mouse:h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>{[1, 2, 3, 4].map((n) => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}</SelectContent>
                  </Select>
                </Fld>
              </div>
              {cfg.connection === "bridge" && <div className="space-y-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3"><Fld label={t("settings.printer.bridgeUrl")} hint={t("settings.printer.bridgeUrlHelp")}><Input className="h-11 sm:mouse:h-10" value={cfg.bridgeUrl} onChange={(e) => setP("bridgeUrl", e.target.value)} placeholder="http://127.0.0.1:17873" /></Fld><Fld label={t("settings.printer.pairingCode")} hint={t("settings.printer.pairingHelp")}><Input className="h-11 font-mono uppercase tracking-[0.3em] sm:mouse:h-10" value={pairingCode} maxLength={6} autoComplete="one-time-code" onChange={(event) => setPairingCode(event.target.value.replace(/[^2-9A-HJ-NP-Z]/gi, "").toUpperCase())} placeholder={bridgePaired ? t("settings.printer.paired") : "ABC234"} /></Fld>{bridgeHealth?.update?.available ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">Hardware Bridge v{bridgeHealth.update.latestVersion} is available. Open Hardware Bridge Setup to update.</div> : null}{bridgeHealth?.ok ? <div className="flex flex-wrap items-center gap-2"><Badge tone="green">Paired · v{bridgeHealth.version}</Badge><Button type="button" size="sm" variant="outline" className="min-h-11 sm:mouse:min-h-8" onClick={() => void testCashDrawer()} disabled={!bridgeHealth.capabilities?.cashDrawer}>{t("settings.printer.testDrawer")}</Button><Button type="button" size="sm" variant="outline" className="min-h-11 sm:mouse:min-h-8" onClick={() => void readScale()} disabled={!bridgeHealth.capabilities?.scale}>{t("settings.printer.readScale")}</Button><Button type="button" size="sm" variant="outline" className="min-h-11 sm:mouse:min-h-8" onClick={() => void testCustomerDisplay()} disabled={!bridgeHealth.capabilities?.customerDisplay}>{t("settings.printer.testDisplay")}</Button>{scaleReading ? <Badge tone="blue">Scale {scaleReading}</Badge> : null}</div> : null}</div>}
              <div className="grid grid-cols-1 gap-2 pt-1 sm:grid-cols-2">
                <Button variant="outline" className="h-11 gap-1.5 rounded-[9px] text-[12px] font-bold sm:mouse:h-9" onClick={() => void scanPrinters()}><Search size={14} /> {t("settings.printer.scan")}</Button>
                <Button variant="outline" className="h-11 gap-1.5 rounded-[9px] text-[12px] font-bold sm:mouse:h-9" onClick={() => void connectPrinter()} disabled={connecting}><Cable size={14} /> {connecting ? "Saving..." : "Connect"}</Button>
                <Button variant="outline" className="h-11 gap-1.5 rounded-[9px] text-[12px] font-bold sm:mouse:h-9" onClick={testPrint}><Printer size={14} /> {t("settings.printer.testPrintCap")}</Button>
                <Button className="h-11 gap-1.5 rounded-[9px] text-[12px] font-black text-white sm:mouse:h-9" style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} onClick={() => void setAsDefault()}><CheckCircle2 size={14} /> {t("settings.printer.setDefault")}</Button>
              </div>
              {scanResult ? <div className="rounded-[10px] border border-blue-100 bg-blue-50 px-3 py-2 text-[12px] font-semibold text-blue-800">{scanResult}</div> : null}
            </div>
          </Card>

          {/* Print settings */}
          <Card>
            <CardHead icon={<Printer size={15} />} title={t("settings.printer.printTitle")} sub={t("settings.printer.printSub")} />
            <div className="px-5 pb-4">
              <RowToggle label={t("settings.printer.autoPrint")} desc={t("settings.printer.autoPrintHelp")} pill={<Switch checked={cfg.autoPrint} onCheckedChange={(v) => setP("autoPrint", v)} />} />
              <RowToggle label={t("settings.printer.askBefore")} desc={t("settings.printer.askBeforeHelp")} pill={<Switch checked={cfg.askBeforePrint} onCheckedChange={(v) => setP("askBeforePrint", v)} />} />
              <RowToggle label={t("settings.printer.customerCopy")} pill={<Switch checked={cfg.customerCopy} onCheckedChange={(v) => setP("customerCopy", v)} />} />
              <RowToggle label={t("settings.printer.shopCopy")} pill={<Switch checked={cfg.shopCopy} onCheckedChange={(v) => setP("shopCopy", v)} />} />
              <RowToggle label={t("settings.printer.autoCut")} desc={t("settings.printer.autoCutHelp")} pill={<Switch checked={cfg.autoCut} onCheckedChange={(v) => setP("autoCut", v)} />} />
              <RowToggle label={t("settings.printer.drawerPulse")} desc={t("settings.printer.drawerPulseHelp")} pill={cfg.connection === "bridge" ? <Switch checked={cfg.cashDrawer} onCheckedChange={(v) => setP("cashDrawer", v)} /> : <Badge tone="amber">{t("settings.printer.bridgeRequired")}</Badge>} />
              <RowToggle label={t("settings.printer.customerDisplay")} desc={t("settings.printer.customerDisplayHelp")} pill={cfg.connection === "bridge" ? <Switch checked={cfg.customerDisplay} onCheckedChange={(v) => setP("customerDisplay", v)} disabled={!bridgeHealth?.capabilities?.customerDisplay} /> : <Badge tone="amber">{t("settings.printer.bridgeRequired")}</Badge>} />
              <RowToggle label={t("settings.printer.printLogo")} pill={<Switch checked={cfg.printLogo} onCheckedChange={(v) => setP("printLogo", v)} />} />
              <RowToggle label={t("settings.printer.upiQr")} desc={t("settings.printer.upiQrHelp")} pill={<Switch checked={cfg.printQr} onCheckedChange={(v) => setP("printQr", v)} />} last />
            </div>
          </Card>
        </div>

        {/* Bill template preview */}
        <Card className="flex flex-col">
          <CardHead icon={<FileText size={15} />} title={t("settings.printer.previewTitle")} sub={`Live ${cfg.paperSize} receipt`} action={<button onClick={testPrint} className="settings-text-action px-2 sm:px-0">{t("settings.printer.testPrint")}</button>} />
          <div className="flex-1 px-5 pb-5">
            <div className="app-table-scroll overflow-auto rounded-[12px] border border-[#e3e9f3] bg-[#eef1f6]">
              <iframe title={t("settings.printer.previewAlt")} srcDoc={previewHtml} className="h-[560px] w-full border-0" />
            </div>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bill content settings */}
        <Card>
          <CardHead icon={<FileText size={15} />} title={t("settings.printer.contentTitle")} sub={t("settings.printer.contentSub")} />
          <div className="px-5 pb-4">
            <RowToggle label={t("settings.printer.showMrp")} pill={<Switch checked={cfg.showMrp} onCheckedChange={(v) => setP("showMrp", v)} />} />
            <RowToggle label={t("settings.printer.showDiscount")} pill={<Switch checked={cfg.showDiscount} onCheckedChange={(v) => setP("showDiscount", v)} />} />
            <RowToggle label={t("settings.printer.showGstBreakup")} pill={<Switch checked={cfg.showGstBreakup} onCheckedChange={(v) => setP("showGstBreakup", v)} />} />
            <RowToggle label={t("settings.printer.showHsn")} pill={<Switch checked={cfg.showHsn} onCheckedChange={(v) => setP("showHsn", v)} />} />
            <RowToggle label={t("settings.printer.showCashier")} pill={<Switch checked={cfg.showCashier} onCheckedChange={(v) => setP("showCashier", v)} />} />
            <RowToggle label={t("settings.printer.showCustomerPhone")} pill={<Switch checked={cfg.showCustomerPhone} onCheckedChange={(v) => setP("showCustomerPhone", v)} />} />
            <RowToggle label={t("settings.printer.showPreviousUdhar")} pill={<Switch checked={cfg.showPreviousUdhar} onCheckedChange={(v) => setP("showPreviousUdhar", v)} />} />
            <RowToggle label={t("settings.printer.showSavings")} pill={<Switch checked={cfg.showSavings} onCheckedChange={(v) => setP("showSavings", v)} />} />
            <RowToggle label={t("settings.printer.showReturnPolicy")} pill={<Switch checked={cfg.showReturnPolicy} onCheckedChange={(v) => setP("showReturnPolicy", v)} />} last />
            <Fld label={t("settings.printer.footerNote")}>
              <Input className="h-11 sm:mouse:h-10" value={cfg.footerText} onChange={(e) => setP("footerText", e.target.value)} />
            </Fld>
            <p className="pt-2 text-[11px] text-[#9aa6bb]">{t("settings.printer.scanHelp")}</p>
          </div>
        </Card>

        {/* Printer queue / test */}
        <Card>
          <CardHead icon={<Printer size={15} />} title={t("settings.printer.queueTitle")} sub={t("settings.printer.queueSub")} action={<button onClick={() => { setJobs([]); toast({ title: t("settings.printer.queueCleared") }); }} className="settings-text-action px-2 sm:px-0">{t("settings.printer.clearQueue")}</button>} />
          <div className="px-5 pb-4">
            {jobs.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-[#dbe4f0] p-6 text-center text-[12px] font-semibold text-[#64748b]">
                No print jobs yet. Use Test Print or Download Receipt to check the setup.
              </div>
            ) : jobs.map((j, i) => (
              <div key={j.id} className={`flex items-center gap-3 py-2.5 ${i < jobs.length - 1 ? "border-b border-[#eef2f8]" : ""}`}>
                <span className={`grid h-8 w-8 place-items-center rounded-[8px] ${["sent", "opened", "saved"].includes(j.status) ? "bg-emerald-50 text-emerald-600" : j.status === "pending" ? "bg-blue-50 text-blue-600" : "bg-rose-50 text-rose-600"}`}>{j.status === "pending" ? <RefreshCcw size={15} className="animate-spin" /> : ["sent", "opened", "saved"].includes(j.status) ? <CheckCircle2 size={15} /> : <XCircle size={15} />}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold text-[var(--brand-ink)]">{j.title}</p>
                  <p className="text-[11px] text-[#64748b]">{j.time}</p>
                </div>
                {j.status === "failed" ? <Button size="sm" variant="outline" className="h-11 gap-1 rounded-[8px] text-[12px] font-bold sm:mouse:h-8" onClick={testPrint}><RefreshCcw size={12} /> {t("settings.printer.retry")}</Button> : <Badge tone={j.status === "pending" ? "blue" : "green"}>{j.status === "saved" ? "Saved" : j.status === "sent" ? "Sent to printer" : j.status === "opened" ? "Dialog opened" : "Sending"}</Badge>}
              </div>
            ))}
            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button variant="outline" className="h-11 gap-1.5 rounded-[9px] text-[12px] font-bold sm:mouse:h-9" onClick={testPrint}><Printer size={14} /> {t("settings.printer.printSample")}</Button>
              <Button variant="outline" className="h-11 gap-1.5 rounded-[9px] text-[12px] font-bold sm:mouse:h-9" onClick={downloadReceiptHtml}><Download size={14} /> {t("settings.printer.downloadReceipt")}</Button>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHead icon={<ShieldCheck size={15} />} title={t("settings.printer.compatTitle")} sub={t("settings.printer.compatSub")} />
        <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 xl:grid-cols-6">
          {hardwareCapabilities.map((capability) => {
            const Icon = capability.icon;
            return <div key={capability.label} className="rounded-xl border border-[#e5eaf2] bg-[#f8fafc] p-3"><div className="flex items-center justify-between"><span className="grid h-8 w-8 place-items-center rounded-lg bg-white text-[var(--brand)] shadow-sm"><Icon size={16} /></span><Badge tone={capability.ready ? "green" : "amber"}>{capability.ready ? "Available" : t("settings.security.unavailable")}</Badge></div><p className="mt-3 text-[12px] font-black text-[var(--brand-ink)]">{capability.label}</p><p className="mt-1 text-[10.5px] leading-4 text-[#64748b]">{capability.detail}</p></div>;
          })}
        </div>
      </Card>
    </SettingsShell>
  );
}
