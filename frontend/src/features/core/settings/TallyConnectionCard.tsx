import { marketBusinessDate } from "@/lib/market";
import { loadAuthSession } from "@/lib/storage/auth-storage";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Download, Link2, Loader2 } from "lucide-react";
import { apiRequest } from "@/lib/api/http";
import { getOfflineScope } from "@/lib/offline/context";
import { offlineDB } from "@/lib/offline/db";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useAppLanguage } from "./i18n";
import { Badge, Card, CardHead, Fld } from "./ui";
import { loadPrinterConfig } from "./printer-config";
import { pairHardwareBridge, discoverTallyViaHardwareBridge, postTallyViaHardwareBridge, type TallyCompany } from "@/features/core/hardware/local-hardware-bridge";
import { confirmationBody, sendPreparedTallyTransfer, type PendingTallyTransfer, type TallyEnvelope } from "./tally-transfer";
import { useDataExport } from "@/features/core/reports/DataExportProvider";

type Connection = { company: TallyCompany | null; currencyCode: string; posted: number; lastPostedAt: string | null };
function shopDate(daysAgo = 0) {
  const market = loadAuthSession().shop?.countryCode === "AE" ? "AE" : "IN";
  const date = new Date(`${marketBusinessDate(new Date(), market)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}
const BOOKS = ["sales", "purchases", "returns", "receipts", "expenses", "production"] as const;
function download(name: string, xml: string) {
  const url = URL.createObjectURL(new Blob([xml], { type: "application/xml;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TallyConnectionCard({ enabled }: { enabled: boolean }) {
  const { t } = useAppLanguage();
  const requestExport = useDataExport();
  const shopId = getOfflineScope().tenant_id;
  const pendingKey = `tally-pending-v1:${shopId}`;
  const [companies, setCompanies] = useState<TallyCompany[]>([]);
  const [pairingCode, setPairingCode] = useState("");
  const [chosen, setChosen] = useState("");
  const [from, setFrom] = useState(() => shopDate(29));
  const [to, setTo] = useState(() => shopDate());
  const [books, setBooks] = useState<string[]>([...BOOKS]);
  const [inventory, setInventory] = useState(false);
  const [preview, setPreview] = useState<TallyEnvelope | null>(null);
  const [livePreview, setLivePreview] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const connection = useQuery({ queryKey: ["tally-connection", shopId], enabled, queryFn: () => apiRequest<Connection>("/integrations/tally/connection"), retry: false });
  const pending = useQuery({ queryKey: ["tally-pending", shopId], queryFn: () => offlineDB.getSetting<PendingTallyTransfer>(pendingKey), retry: false });
  const query = new URLSearchParams({ from, to, inventory: inventory ? "1" : "0", include: books.join(",") }).toString();
  const assertShop = () => { if (getOfflineScope().tenant_id !== shopId) throw new Error(t("tally.checkFirst")); };
  const save = async (value: PendingTallyTransfer | null) => { assertShop(); await offlineDB.setSetting(pendingKey, value); await pending.refetch(); };
  const confirm = async (value: PendingTallyTransfer) => { assertShop(); await apiRequest("/integrations/exports/tally/posted", { method: "POST", body: JSON.stringify(confirmationBody(value)) }); };
  const action = useMutation({
    mutationFn: async (run: () => Promise<void>) => { setError(""); setMessage(""); await run(); },
    onError: (cause) => { setError(cause instanceof Error ? cause.message : t("settings.integrations.genericError")); void pending.refetch(); },
  });
  const busy = action.isPending;
  const blocked = busy || Boolean(pending.data) || pending.isPending || pending.isError || !enabled;
  const rangeValid = Boolean(from && to && from <= to && books.length);
  const linked = connection.data?.company;
  const selected = companies.find((company) => company.guid === chosen);
  const available = companies.find((company) => company.guid === linked?.guid && company.name === linked?.name && company.currencyCode === connection.data?.currencyCode);
  const change = (fn: () => void) => { fn(); setPreview(null); };
  const check = () => action.mutate(async () => {
    const printer = await loadPrinterConfig();
    if (pairingCode) { await pairHardwareBridge(printer.bridgeUrl, pairingCode); setPairingCode(""); }
    const result = await discoverTallyViaHardwareBridge(printer.bridgeUrl);
    setCompanies(result.companies); setChosen(linked?.guid ?? (result.companies.length === 1 ? result.companies[0].guid : ""));
    setMessage(result.companies.length ? t("tally.found", { count: result.companies.length }) : t("tally.noCompanies"));
  });
  const prepare = (unsent: boolean) => action.mutate(async () => {
    const result = await apiRequest<TallyEnvelope>(`/integrations/exports/tally/envelope?${query}&unsent=${unsent ? "1" : "0"}`);
    setPreview(result); setLivePreview(unsent);
    setMessage(t("tally.prepared", { count: result.count, skipped: result.skipped }));
  });
  const send = () => action.mutate(async () => {
    if (!livePreview || !preview || !available || !linked || preview.company.guid !== linked.guid) throw new Error(t("tally.checkFirst"));
    // Reject a shop switch during preparation before any local-network write.
    if (getOfflineScope().tenant_id !== shopId) throw new Error(t("tally.checkFirst"));
    const printer = await loadPrinterConfig();
    if (!navigator.locks) throw new Error(t("tally.browserLock"));
    await navigator.locks.request(`tally-transfer:${shopId}`, { ifAvailable: true }, async (lock) => {
      if (!lock || await offlineDB.getSetting(pendingKey)) throw new Error(t("tally.pendingElsewhere"));
      await sendPreparedTallyTransfer(preview, { post: (xml, company) => { assertShop(); return postTallyViaHardwareBridge(printer.bridgeUrl, xml, company); }, save, confirm });
    });
    setPreview(null); setMessage(t("tally.sent", { count: preview.count })); await connection.refetch();
  });
  const recover = () => action.mutate(async () => {
    if (!pending.data || (pending.data.phase !== "accepted" && !reviewed)) return;
    await confirm(pending.data); await save(null); setReviewed(false); await connection.refetch(); setMessage(t("tally.confirmed"));
  });

  return <Card>
    <CardHead icon={<Link2 size={15} />} title={t("tally.title")} sub={t("tally.subtitle")}
      action={<Badge tone={linked && available ? "green" : "amber"}>{linked && available ? t("tally.connected") : t("tally.checkNeeded")}</Badge>} />
    <div className="space-y-4 px-5 pb-5">
      {!enabled && <p className="text-sm text-muted-foreground">{t("settings.integrations.tallyLocked")}</p>}
      <ol className="list-decimal space-y-2 pl-5 text-xs leading-5 text-muted-foreground">
        <li>{t("tally.step1")} <a href="/settings/printer" className="font-semibold text-primary underline">{t("tally.bridgeSetup")}</a></li>
        <li>{t("tally.step2")}</li><li>{t("tally.step3")}</li>
      </ol>
      <Fld label={t("settings.printer.pairingCode")} hint={t("tally.pairingHelp")}><Input aria-label={t("settings.printer.pairingCode")} value={pairingCode} maxLength={6} autoComplete="one-time-code" disabled={busy || !enabled} onChange={(event) => setPairingCode(event.target.value.replace(/[^2-9A-HJ-NP-Z]/gi, "").toUpperCase())} /></Fld>
      <Button variant="outline" disabled={busy || !enabled || (pairingCode.length > 0 && pairingCode.length !== 6)} onClick={check}>{busy ? <Loader2 size={14} className="mr-2 animate-spin" /> : <Link2 size={14} className="mr-2" />}{t("tally.check")}</Button>
      {connection.isError && <p role="alert" className="text-sm text-destructive">{String(connection.error.message)}</p>}
      {linked ? <div className="rounded-xl border p-3 text-sm"><p className="font-semibold">{linked.name} · {linked.currencyCode}</p><p className="text-xs text-muted-foreground">{t("tally.history", { count: connection.data?.posted ?? 0 })}</p>{connection.data?.lastPostedAt && <time className="text-xs" dateTime={connection.data.lastPostedAt}>{new Date(connection.data.lastPostedAt).toLocaleString()}</time>}</div>
        : companies.length > 0 && <div className="space-y-2"><Fld label={t("tally.company")}><select aria-label={t("tally.company")} className="h-11 w-full rounded-lg border bg-background px-3 text-sm text-foreground" value={chosen} disabled={blocked} onChange={(e) => setChosen(e.target.value)}><option value="">{t("tally.choose")}</option>{companies.map((company) => <option key={company.guid} value={company.guid}>{company.name} · {company.currencyCode ?? company.currency ?? t("tally.unknownCurrency")}</option>)}</select></Fld>
          <Button disabled={blocked || !selected || selected.currencyCode !== connection.data?.currencyCode} onClick={() => action.mutate(async () => {
            if (!selected) return; await apiRequest("/integrations/tally/connection", { method: "POST", body: JSON.stringify({ guid: selected.guid, name: selected.name, currencyCode: selected.currencyCode }) }); await connection.refetch();
          })}>{t("tally.connect")}</Button><p className="text-xs text-muted-foreground">{t("tally.currencyMatch", { currency: connection.data?.currencyCode ?? "—" })}</p></div>}
      {pending.isError && <p role="alert" className="text-sm text-destructive">{t("tally.storageError")}</p>}
      {pending.data && <div className="space-y-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
        <p className="text-sm font-semibold">{pending.data.phase === "accepted" ? t("tally.receivedPending") : t("tally.uncertain")}</p>
        <p className="text-xs">{t("tally.recoveryHelp", { company: pending.data.company.name, count: pending.data.documents.length })}</p>
        <details className="text-xs"><summary>{t("tally.voucherList")}</summary><ul className="mt-2 max-h-48 overflow-auto">{pending.data.documents.map((doc) => <li key={doc.remoteId}>{doc.voucherNumber}</li>)}</ul></details>
        {pending.data.phase !== "accepted" && <label className="flex gap-2 text-xs"><Checkbox checked={reviewed} onCheckedChange={(v) => setReviewed(v === true)} />{t("tally.reviewed")}</label>}
        <Button variant="outline" disabled={busy || (pending.data.phase !== "accepted" && !reviewed)} onClick={recover}>{t("tally.confirmOnly")}</Button>
      </div>}
      <fieldset disabled={blocked} className="space-y-3 disabled:opacity-60">
        <legend className="mb-2 text-sm font-semibold">{t("tally.period")}</legend>
        <div className="grid grid-cols-2 gap-3"><Fld label={t("inventory.transfers.from")}><Input aria-label={t("inventory.transfers.from")} type="date" value={from} onChange={(e) => change(() => setFrom(e.target.value))} /></Fld><Fld label={t("settings.integrations.dateTo")}><Input aria-label={t("settings.integrations.dateTo")} type="date" value={to} onChange={(e) => change(() => setTo(e.target.value))} /></Fld></div>
        <div className="grid grid-cols-2 gap-2">{BOOKS.map((book) => <label key={book} className="flex items-center gap-2 text-xs"><Checkbox disabled={blocked} checked={books.includes(book)} onCheckedChange={(v) => change(() => setBooks((current) => v ? [...current, book] : current.filter((b) => b !== book)))} />{t(`settings.integrations.book.${book}`)}</label>)}</div>
        <label className="flex gap-2 text-xs"><Checkbox disabled={blocked} checked={inventory} onCheckedChange={(v) => change(() => setInventory(v === true))} />{t("settings.integrations.includeStock")}</label>
        <div className="flex flex-wrap gap-2"><Button disabled={blocked || !rangeValid || !available} onClick={() => prepare(true)}>{t("tally.preview")}</Button><Button variant="outline" disabled={blocked || !rangeValid} onClick={() => prepare(false)}>{t("tally.filePreview")}</Button></div>
      </fieldset>
      {preview && <section className="space-y-3 rounded-xl border p-3" aria-label={t("tally.preview")}>
        <p className="text-sm font-semibold">{preview.company.name} · {preview.company.currencyCode}</p>
        <p className="text-xs">{t("tally.prepared", { count: preview.count, skipped: preview.skipped })}</p>
        <p className="text-xs text-muted-foreground">{t("tally.masters", { count: preview.masterCount })}</p>
        <details className="text-xs"><summary>{t("tally.voucherList")}</summary><ul className="mt-2 max-h-48 overflow-auto">{preview.documents.map((doc) => <li key={doc.remoteId}>{doc.voucherNumber} · {doc.type}</li>)}</ul></details>
        <p className="text-xs text-muted-foreground">{t("tally.fileHelp")}</p>
        <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={busy || !preview.masterCount} onClick={() => requestExport({ reportType: "tally", format: "xml", from, to }, async () => download(`tally-masters-${from}-${to}.xml`, preview.mastersXml))}><Download size={14} className="mr-2" />{t("tally.downloadMasters")}</Button>
          <Button variant="outline" disabled={busy || !preview.count} onClick={() => requestExport({ reportType: "tally", format: "xml", from, to }, async () => download(`tally-vouchers-${from}-${to}.xml`, preview.vouchersXml))}><Download size={14} className="mr-2" />{t("tally.downloadVouchers")}</Button>
          <Button disabled={blocked || !livePreview || !available || !preview.signature || !preview.count} onClick={send}>{t("tally.send", { count: preview.count })}</Button></div>
      </section>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}{message && <p role="status" className="text-sm">{message}</p>}
      <p className="text-xs text-muted-foreground">{t("tally.scope")}</p>
      <a className="text-xs text-primary underline" href="https://help.tallysolutions.com/import-data-from-xml-or-json/" target="_blank" rel="noreferrer">{t("settings.integrations.tallyInstructions")}</a>
    </div>
  </Card>;
}
