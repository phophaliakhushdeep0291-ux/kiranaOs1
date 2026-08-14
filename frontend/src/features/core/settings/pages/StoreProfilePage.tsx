import { useAppLanguage } from "@/features/core/settings/i18n";
import { useEffect, useRef, useState } from "react";
import { getGetShopQueryKey, useUpdateShop } from "@/lib/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/core/auth/useAuth";
import { useSubscriptionSnapshot } from "@/features/core/subscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  BadgeCheck, Building2, CheckCircle2, FileText, Landmark, Loader2, MapPin,
  Navigation, Receipt, Store, Upload, Clock,
} from "lucide-react";
import { Link } from "wouter";
import { SettingsShell } from "@/features/core/settings/SettingsShell";
import { Card, CardHead, Fld, Badge } from "@/features/core/settings/ui";
import { useSettingsPrefs } from "@/features/core/settings/use-settings-prefs";
import { OwnerOrderingCard } from "@/features/core/customer-order/OwnerOrderingCard";
import { OwnerPinModal } from "@/components/security/OwnerPinModal";
import { getBusinessTypeCompatibility, getShopBootstrap, type BusinessTypeCompatibility } from "@/features/core/settings/api";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  BUSINESS_TYPE_DEFS,
  businessTypeFromLabel,
  getStoredBusinessType,
  isBusinessType,
  offeredBusinessTypes,
  saveBusinessType,
  type BusinessType,
} from "@/features/core/settings/business-types";

const BUSINESS_TYPE_OPTIONS = offeredBusinessTypes().map((key) => [key, BUSINESS_TYPE_DEFS[key]] as const);

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] as const;
type DayHours = { open: boolean; from: string; to: string };
const DEFAULT_DAY: DayHours = { open: true, from: "09:00", to: "21:00" };

const DOCS = [
  { key: "gst", label: "GST Certificate" },
  { key: "license", label: "Shop License" },
  { key: "pan", label: "PAN Card" },
  { key: "ownerId", label: "Owner ID Proof" },
  { key: "address", label: "Address Proof" },
] as const;

function clean(value: string) {
  return value.trim();
}

interface StoredDoc {
  name: string;
  size: number;
  type: string;
  at: string;
  dataUrl?: string;
}

/** Older builds stored the string "uploaded"; treat that as no real file. */
function normaliseDoc(value: unknown): StoredDoc | null {
  if (!value || typeof value !== "object") return null;
  const doc = value as Partial<StoredDoc>;
  if (typeof doc.name !== "string" || !doc.name) return null;
  return { name: doc.name, size: Number(doc.size) || 0, type: String(doc.type ?? ""), at: String(doc.at ?? new Date().toISOString()), dataUrl: doc.dataUrl };
}

function formatFileSize(bytes: number) {
  if (!bytes) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function StoreProfilePage() {
  const { t } = useAppLanguage();
  const { toast } = useToast();
  const { user, updateShop: updateAuthShop } = useAuth();
  const { snapshot } = useSubscriptionSnapshot();
  const queryClient = useQueryClient();
  const { prefs, patch, shop, hydrated } = useSettingsPrefs();
  const bootstrapQuery = useQuery({ queryKey: ["shop-bootstrap"], queryFn: getShopBootstrap, enabled: Boolean(shop?.id), staleTime: 30_000 });
  const businessTypeLocked = bootstrapQuery.data?.businessTypeLocked ?? false;

  const sp = (prefs.storeProfile ?? {}) as Record<string, string>;
  const hours = (prefs.hours ?? {}) as Record<string, DayHours>;
  const bank = (prefs.bank ?? {}) as Record<string, string>;
  const docs = (prefs.docs ?? {}) as Record<string, unknown>;

  const [biz, setBiz] = useState({ name: "", ownerName: "", phone: "", altPhone: "", email: "", gstNumber: "", pan: "", businessTypeKey: getStoredBusinessType() as BusinessType, currency: "₹ Indian Rupee" });
  const [addr, setAddr] = useState({ address: "", city: "", state: "", pincode: "", country: "India", deliveryRadius: "" });
  const [pinOpen, setPinOpen] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [changeReviewOpen, setChangeReviewOpen] = useState(false);
  const [changeTarget, setChangeTarget] = useState<BusinessType>("other");
  const [changeReport, setChangeReport] = useState<BusinessTypeCompatibility | null>(null);
  const [changeReviewLoading, setChangeReviewLoading] = useState(false);
  const seeded = useRef(false);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const docInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const updateShop = useUpdateShop({
    mutation: {
      onSuccess: (updatedShop) => {
        queryClient.setQueryData(getGetShopQueryKey(), updatedShop);
        void queryClient.invalidateQueries({ queryKey: getGetShopQueryKey() });
        updateAuthShop(updatedShop);
        toast({ title: t("settings.store.saved") });
      },
      onError: (err: unknown) => toast({ title: t("settings.store.saveFailed"), description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" }),
    },
  });

  useEffect(() => {
    if (seeded.current || !hydrated || !shop) return;
    seeded.current = true;
    setBiz({
      name: shop.name ?? "", ownerName: shop.ownerName ?? "", phone: shop.phone ?? "",
      altPhone: sp.altPhone ?? "", email: sp.email ?? user?.email ?? "", gstNumber: shop.gstNumber ?? "",
      pan: sp.pan ?? "",
      businessTypeKey: isBusinessType(sp.businessTypeKey)
        ? sp.businessTypeKey
        : businessTypeFromLabel(sp.businessType) ?? getStoredBusinessType(),
      currency: sp.currency ?? "₹ Indian Rupee",
    });
    setAddr({
      address: shop.address ?? "", city: shop.city ?? "", state: sp.state ?? "",
      pincode: sp.pincode ?? "", country: sp.country ?? "India", deliveryRadius: sp.deliveryRadius ?? "",
    });
  }, [hydrated, shop, sp, user?.email]);

  function requestSaveStoreDetails() {
    setPinError(null);
    setPinOpen(true);
  }

  async function reviewBusinessTypeChange() {
    setChangeReviewLoading(true);
    setChangeReport(null);
    try {
      setChangeReport(await getBusinessTypeCompatibility(changeTarget));
    } catch (error) {
      toast({ title: t("settings.store.reviewFailed"), description: (error as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" });
    } finally {
      setChangeReviewLoading(false);
    }
  }

  async function saveStoreDetails(ownerPin: string) {
    setPinError(null);
    try {
      const profileData = {
        name: clean(biz.name),
        ownerName: clean(biz.ownerName),
        phone: clean(biz.phone),
        gstNumber: clean(biz.gstNumber),
        address: clean(addr.address),
        city: clean(addr.city),
      };
      const updatedShop = await updateShop.mutateAsync({
        data: {
          ...profileData,
          ownerPin,
        },
      });
      setBiz((current) => ({
        ...current,
        name: updatedShop.name ?? profileData.name,
        ownerName: updatedShop.ownerName ?? profileData.ownerName,
        phone: updatedShop.phone ?? profileData.phone,
        gstNumber: updatedShop.gstNumber ?? profileData.gstNumber,
        altPhone: clean(current.altPhone),
        email: clean(current.email),
        pan: clean(current.pan),
      }));
      setAddr((current) => ({
        ...current,
        address: updatedShop.address ?? profileData.address,
        city: updatedShop.city ?? profileData.city,
        state: clean(current.state),
        pincode: clean(current.pincode),
        country: clean(current.country || "India"),
        deliveryRadius: clean(current.deliveryRadius),
      }));
      const profilePrefsShop = await patch({
        storeProfile: {
          ...sp,
          altPhone: clean(biz.altPhone),
          email: clean(biz.email),
          pan: clean(biz.pan),
          businessTypeKey: biz.businessTypeKey,
          businessType: BUSINESS_TYPE_DEFS[biz.businessTypeKey].label,
          currency: biz.currency,
          state: clean(addr.state),
          pincode: clean(addr.pincode),
          country: clean(addr.country || "India"),
          deliveryRadius: clean(addr.deliveryRadius),
        },
      }, { immediate: true });
      saveBusinessType(biz.businessTypeKey); // adapt nav/dashboard/product form instantly
      const finalShop = {
        ...(profilePrefsShop ?? updatedShop),
        name: updatedShop.name,
        ownerName: updatedShop.ownerName,
        phone: updatedShop.phone,
        gstNumber: updatedShop.gstNumber,
        address: updatedShop.address,
        city: updatedShop.city,
      };
      queryClient.setQueryData(getGetShopQueryKey(), finalShop);
      updateAuthShop(finalShop);
      setPinOpen(false);
    } catch (err) {
      const message = (err as { data?: { message?: string }; message?: string })?.data?.message ?? (err as { message?: string })?.message ?? "Could not save store profile. Try again.";
      setPinError(message);
    }
  }

  const setDay = (day: string, next: DayHours) => patch({ hours: { ...hours, [day]: next } });
  const setBank = (key: string, val: string) => patch({ bank: { ...bank, [key]: val } });

  function useCurrentLocation() {
    if (!navigator.geolocation) { toast({ title: t("settings.store.locationUnsupported"), variant: "destructive" }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { patch({ storeProfile: { ...sp, geo: `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}` } }); toast({ title: t("settings.store.locationCaptured"), description: t("settings.store.locationSaved") }); },
      () => toast({ title: t("settings.store.locationFailed"), description: t("settings.store.locationFailedHelp"), variant: "destructive" }),
    );
  }
  function openInMaps() {
    const q = encodeURIComponent([addr.address, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ") || "my shop");
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank", "noopener");
  }
  /**
   * Documents are held on this device until a verification service exists to
   * receive them — so the row records the real file name, size and date rather
   * than flipping a badge to "Uploaded" with nothing behind it.
   */
  function attachDocument(key: string, file?: File | null) {
    if (!file) return;
    const isAllowed = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!isAllowed) {
      toast({ title: t("settings.store.usePdfOrImage"), description: t("settings.store.usePdfOrImageHelp"), variant: "destructive" });
      return;
    }
    if (file.size > 4 * 1024 * 1024) {
      toast({ title: t("settings.store.fileTooLarge"), description: t("settings.store.fileTooLargeHelp"), variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      patch({
        docs: {
          ...docs,
          [key]: { name: file.name, size: file.size, type: file.type, at: new Date().toISOString(), dataUrl: String(reader.result || "") },
        },
      });
      toast({ title: `${file.name} attached`, description: t("settings.store.storedOnDevice") });
    };
    reader.onerror = () => toast({ title: t("settings.store.readFailed"), variant: "destructive" });
    reader.readAsDataURL(file);
  }

  function removeDocument(key: string) {
    const next = { ...docs };
    delete next[key];
    patch({ docs: next });
    toast({ title: t("settings.store.documentRemoved") });
  }

  function openDocument(doc: StoredDoc) {
    if (!doc.dataUrl) return;
    const win = window.open();
    if (!win) {
      toast({ title: t("settings.store.allowPopups"), description: t("settings.store.allowPopupsHelp"), variant: "destructive" });
      return;
    }
    win.document.write(
      doc.type === "application/pdf"
        ? `<iframe src="${doc.dataUrl}" style="border:0;width:100%;height:100%"></iframe>`
        : `<img src="${doc.dataUrl}" style="max-width:100%" alt="">`,
    );
  }
  function uploadLogo(file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: t("settings.store.chooseImage"), variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      patch({ storeProfile: { ...sp, logoDataUrl: String(reader.result || "") } });
      toast({ title: t("settings.store.logoSaved"), description: t("settings.store.logoSavedHelp") });
    };
    reader.onerror = () => toast({ title: t("settings.store.logoReadFailed"), variant: "destructive" });
    reader.readAsDataURL(file);
  }

  const storeId = shop?.id ? `KRN-${String(shop.id).slice(-6).toUpperCase()}` : "—";
  const planName = snapshot?.planCode ? snapshot.planCode.charAt(0).toUpperCase() + snapshot.planCode.slice(1) : "Free";

  return (
    <SettingsShell>
      {/* Store Identity Hero */}
      <Card>
          <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <span className="grid h-[76px] w-[76px] shrink-0 place-items-center overflow-hidden rounded-[16px] bg-[var(--brand-soft)] text-4xl">
              {sp.logoDataUrl ? <img src={String(sp.logoDataUrl)} alt="Store logo" className="h-full w-full object-cover" /> : "🏪"}
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[20px] font-black tracking-tight text-[var(--brand-ink)]">{biz.name || shop?.name || "My Store"}</h2>
                {/* GSTIN is the one identity claim the server actually validates. */}
                {shop?.gstNumber
                  ? <Badge tone="green"><BadgeCheck size={12} /> {t("settings.store.gstRegistered")}</Badge>
                  : <Badge tone="gray">{t("settings.store.noGstin")}</Badge>}
                <Badge tone="amber">{planName} Plan</Badge>
              </div>
              <p className="mt-0.5 text-[12px] text-[#52627e]">{BUSINESS_TYPE_DEFS[biz.businessTypeKey].label} · Store ID {storeId}</p>
              <p className="text-[12px] text-[#52627e]">{[addr.address, addr.city].filter(Boolean).join(", ") || "Add your store address"}</p>
            </div>
          </div>
          <div className="grid shrink-0 grid-cols-1 gap-2 sm:grid-cols-2">
            <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => uploadLogo(e.target.files?.[0])} />
            <Button variant="outline" className="h-10 gap-2 rounded-[10px] font-bold" onClick={() => logoInputRef.current?.click()}><Upload size={15} /> Upload Logo</Button>
            <Button onClick={requestSaveStoreDetails} disabled={updateShop.isPending} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-10 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {updateShop.isPending ? <Loader2 size={15} className="animate-spin" /> : <Store size={15} />} Save Profile
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Business Details */}
        <Card>
          <CardHead icon={<Building2 size={15} />} title="Business Details" sub="Legal & contact information" />
          <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2">
            <Fld label="Business Name"><Input className="h-10" value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} /></Fld>
            <Fld label="Owner Name"><Input className="h-10" value={biz.ownerName} onChange={(e) => setBiz({ ...biz, ownerName: e.target.value })} /></Fld>
            <Fld label="Phone Number"><Input className="h-10" value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} /></Fld>
            <Fld label="Alternate Phone"><Input className="h-10" value={biz.altPhone} onChange={(e) => setBiz({ ...biz, altPhone: e.target.value })} /></Fld>
            <Fld label="Email"><Input className="h-10" value={biz.email} onChange={(e) => setBiz({ ...biz, email: e.target.value })} /></Fld>
            <Fld label="GSTIN"><Input className="h-10" value={biz.gstNumber} onChange={(e) => setBiz({ ...biz, gstNumber: e.target.value })} /></Fld>
            <Fld label="PAN Number"><Input className="h-10" value={biz.pan} onChange={(e) => setBiz({ ...biz, pan: e.target.value })} /></Fld>
            <Fld label="Business Type" hint={businessTypeLocked ? "Locked because products or bills exist" : "Adapts navigation, dashboard, categories & units to your trade"}>
              <Select disabled={businessTypeLocked} value={biz.businessTypeKey} onValueChange={(v) => setBiz({ ...biz, businessTypeKey: v as BusinessType })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{BUSINESS_TYPE_OPTIONS.map(([key, def]) => <SelectItem key={key} value={key}>{def.emoji} {def.label}</SelectItem>)}</SelectContent>
              </Select>
              {businessTypeLocked ? <Button type="button" variant="outline" className="mt-2 h-9 w-full text-xs font-bold" onClick={() => { setChangeTarget(biz.businessTypeKey === "other" ? "kirana" : "other"); setChangeReport(null); setChangeReviewOpen(true); }}>{t("settings.store.requestTypeChange")}</Button> : null}
            </Fld>
          </div>
        </Card>

        {/* Address & Location */}
        <Card>
          <CardHead icon={<MapPin size={15} />} title="Address & Location" sub="Shop address & delivery area" action={<button type="button" onClick={openInMaps} className="tap-target text-[12px] font-bold text-[var(--brand)] hover:underline">{t("settings.store.openInMaps")}</button>} />
          <div className="space-y-3 px-5 pb-5">
            <Fld label="Shop Address"><Input className="h-10" value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} /></Fld>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Fld label="City"><Input className="h-10" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></Fld>
              <Fld label="State"><Input className="h-10" value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} /></Fld>
              <Fld label="Pincode"><Input className="h-10" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value })} /></Fld>
              <Fld label="Country"><Input className="h-10" value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value })} /></Fld>
            </div>
            <div className="flex flex-col gap-3 rounded-[10px] border border-[var(--brand-border)] bg-[#f3f8ff] px-3 py-3 sm:flex-row sm:items-center">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-[var(--brand)] shadow-sm"><MapPin size={16} /></span>
              <p className="min-w-0 flex-1 text-[11px] font-medium text-[#34507f]">{sp.geo ? `Pinned at ${sp.geo}` : "Pin your exact shop location for delivery & maps."}</p>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-[8px] text-[12px] font-bold" onClick={useCurrentLocation}><Navigation size={13} /> {t("settings.store.useCurrent")}</Button>
            </div>
            <Fld label="Delivery Radius (km)" hint="Used for local delivery suggestions"><Input className="h-10" value={addr.deliveryRadius} onChange={(e) => setAddr({ ...addr, deliveryRadius: e.target.value })} placeholder="e.g. 3" /></Fld>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bill Branding — configured on the Printer & Receipt tab (single source of truth) */}
        <Card>
          <CardHead icon={<Receipt size={15} />} title="Bill Branding" sub="How your receipt looks" />
          <div className="space-y-3 px-5 pb-5">
            <p className="text-[12.5px] leading-relaxed text-[#52627e]">
              Receipt branding — footer message, GSTIN/HSN visibility, GST breakup, paper size and number of copies — lives on the <strong>{t("settings.store.printerReceipt")}</strong> tab, so there's one place that controls how every bill prints and is shared.
            </p>
            <Link href="/settings/printer" className="inline-flex">
              <Button variant="outline" className="h-11 gap-2 rounded-[10px] font-bold lg:mouse:h-10"><Receipt size={15} /> {t("settings.store.openPrinterSettings")}</Button>
            </Link>
          </div>
        </Card>

        {/* Operating Hours */}
        <Card>
          <CardHead icon={<Clock size={15} />} title="Operating Hours" sub="Set open & close times" />
          <div className="px-5 pb-5">
            {DAYS.map((day) => {
              const h = hours[day] ?? DEFAULT_DAY;
              return (
                <div key={day} className="flex flex-col gap-2 border-b border-[#eef2f8] py-2 last:border-0 sm:flex-row sm:items-center sm:gap-3">
                  {/* Seven identical rows of a switch and two clocks. Without the
                      day in each control's name they reach a screen reader as
                      "switch, time, time" seven times over, with nothing to say
                      which day is being closed. */}
                  <span className="w-[84px] shrink-0 text-[12px] font-bold text-[var(--brand-ink)]">{day}</span>
                  <Switch aria-label={`${day} — open for business`} checked={h.open} onCheckedChange={(v) => setDay(day, { ...h, open: v })} />
                  {h.open ? (
                    <div className="flex flex-1 items-center gap-1.5 sm:justify-end">
                      <Input aria-label={`${day} opening time`} className="h-8 w-[88px] text-[12px]" type="time" value={h.from} onChange={(e) => setDay(day, { ...h, from: e.target.value })} />
                      <span className="text-[11px] text-[#94a3b8]">to</span>
                      <Input aria-label={`${day} closing time`} className="h-8 w-[88px] text-[12px]" type="time" value={h.to} onChange={(e) => setDay(day, { ...h, to: e.target.value })} />
                    </div>
                  ) : <span className="flex-1 text-[12px] font-semibold text-[#94a3b8] sm:text-right">{t("settings.store.closed")}</span>}
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bank / UPI */}
        <Card>
          <CardHead icon={<Landmark size={15} />} title="Bank / UPI Details" sub="For bill QR & payment reminders" />
          <div className="grid grid-cols-1 gap-3 px-5 pb-5 sm:grid-cols-2">
            <div className="sm:col-span-2"><Fld label="UPI ID"><Input className="h-10" value={bank.upi ?? ""} placeholder="store@upi" onChange={(e) => setBank("upi", e.target.value)} /></Fld></div>
            <Fld label="Bank Name"><Input className="h-10" value={bank.bankName ?? ""} onChange={(e) => setBank("bankName", e.target.value)} /></Fld>
            <Fld label="Account Holder"><Input className="h-10" value={bank.holder ?? ""} onChange={(e) => setBank("holder", e.target.value)} /></Fld>
            <Fld label="Account Number"><Input className="h-10" value={bank.account ?? ""} onChange={(e) => setBank("account", e.target.value)} /></Fld>
            <Fld label="IFSC"><Input className="h-10" value={bank.ifsc ?? ""} onChange={(e) => setBank("ifsc", e.target.value)} /></Fld>
          </div>
        </Card>

        {/* Verification Documents */}
        <Card>
          <CardHead icon={<FileText size={15} />} title="Verification Documents" sub="Upload for a verified badge" />
          <div className="px-5 pb-5">
            {DOCS.map((d) => {
              const doc = normaliseDoc(docs[d.key]);
              return (
                <div key={d.key} className="flex flex-wrap items-center gap-3 border-b border-[#eef2f8] py-2.5 last:border-0">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#f4f7fb] text-[#536583]"><FileText size={14} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold text-[var(--brand-ink)]">{d.label}</span>
                    {doc ? <span className="block truncate text-[11px] text-[#64748b]">{doc.name} · {formatFileSize(doc.size)} · {new Date(doc.at).toLocaleDateString("en-IN")}</span> : null}
                  </span>
                  {doc
                    ? <Badge tone="green"><CheckCircle2 size={11} /> {t("settings.store.attached")}</Badge>
                    : <Badge tone="amber">{t("settings.store.missing")}</Badge>}
                  <input
                    ref={(node) => { docInputRefs.current[d.key] = node; }}
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(event) => { attachDocument(d.key, event.target.files?.[0]); event.target.value = ""; }}
                  />
                  {doc ? (
                    <span className="flex gap-2">
                      <Button size="sm" variant="outline" className="h-8 rounded-[8px] text-[12px] font-bold" onClick={() => openDocument(doc)}>View</Button>
                      <Button size="sm" variant="outline" className="h-8 rounded-[8px] text-[12px] font-bold text-rose-600" onClick={() => removeDocument(d.key)}>Remove</Button>
                    </span>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8 rounded-[8px] text-[12px] font-bold" onClick={() => docInputRefs.current[d.key]?.click()}>Choose file</Button>
                  )}
                </div>
              );
            })}
            <p className="mt-2 text-[11px] text-[#9aa6bb]">Documents stay on this device — Artha has no verification upload service yet, so nothing is sent anywhere and no badge is granted automatically.</p>
          </div>
        </Card>
      </div>

      {/* Customer QR self-order (owner opt-in) */}
      <OwnerOrderingCard
        enabled={Boolean((prefs.customerOrdering as { enabled?: boolean } | undefined)?.enabled)}
        onToggle={async (v) => {
          const updated = await patch({ customerOrdering: { enabled: v } }, { immediate: true });
          if (!updated) {
            await patch({ customerOrdering: { enabled: !v } });
            toast({
              title: t("settings.store.qrSaveFailed"),
              description: t("settings.store.checkConnection"),
              variant: "destructive",
            });
            return;
          }
          toast({ title: v ? "QR ordering turned on" : "QR ordering turned off" });
        }}
        shopId={shop?.id ?? null}
      />

      <div className="flex justify-end pb-2">
        <Button onClick={requestSaveStoreDetails} disabled={updateShop.isPending} style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }} className="h-11 gap-2 rounded-[10px] px-6 font-black text-white hover:opacity-95">
          {updateShop.isPending ? <><Loader2 size={16} className="animate-spin" /> {t("settings.store.saving")}</> : <><CheckCircle2 size={16} /> {t("settings.store.saveAll")}</>}
        </Button>
      </div>
      <OwnerPinModal
        open={pinOpen}
        title="Approve store profile update"
        description="Store name, owner, GST, address and phone are protected fields. Enter the owner PIN to save this change."
        confirmLabel="Save profile"
        loading={updateShop.isPending}
        error={pinError}
        onCancel={() => {
          if (!updateShop.isPending) {
            setPinOpen(false);
            setPinError(null);
          }
        }}
        onConfirm={({ ownerPin }) => saveStoreDetails(ownerPin)}
      />
      <Dialog open={changeReviewOpen} onOpenChange={setChangeReviewOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("settings.store.reviewTypeChange")}</DialogTitle>
            <DialogDescription>{t("settings.store.reviewHelp")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Fld label="Requested business type">
              <Select value={changeTarget} onValueChange={(value) => { setChangeTarget(value as BusinessType); setChangeReport(null); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{BUSINESS_TYPE_OPTIONS.filter(([key]) => key !== biz.businessTypeKey).map(([key, def]) => <SelectItem key={key} value={key}>{def.emoji} {def.label}</SelectItem>)}</SelectContent>
              </Select>
            </Fld>
            {changeReport ? (
              <div className="space-y-3 rounded-xl border bg-muted/30 p-4 text-sm">
                <div className="flex items-center justify-between gap-3"><span className="font-semibold">{t("settings.store.recommendation")}</span><Badge tone={changeReport.decision === "NEW_SHOP_REQUIRED" ? "amber" : changeReport.decision === "SAFE_BEFORE_TRANSACTIONS" ? "green" : "blue"}>{changeReport.decision.replace(/_/g, " ")}</Badge></div>
                <p className="text-muted-foreground">Existing data: {changeReport.counts.products} products, {changeReport.counts.bills} bills, {changeReport.counts.inventoryLots} inventory lots.</p>
                {changeReport.disabledCapabilities.length ? <p><strong>{t("settings.store.wouldDisable")}</strong> {changeReport.disabledCapabilities.join(", ")}</p> : null}
                {changeReport.enabledCapabilities.length ? <p><strong>{t("settings.store.wouldEnable")}</strong> {changeReport.enabledCapabilities.join(", ")}</p> : null}
                <p className="text-muted-foreground">{changeReport.decision === "NEW_SHOP_REQUIRED" ? "These engines are incompatible. Create a separate shop profile so historical stock and billing records remain valid." : changeReport.decision === "REVIEWED_MIGRATION_REQUIRED" ? "This change is broadly compatible, but must be run as a reviewed migration; it is not applied automatically." : "This change is safe before meaningful transactions and can be saved from the profile selector."}</p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setChangeReviewOpen(false)}>{t("settings.store.close")}</Button>
            <Button onClick={() => void reviewBusinessTypeChange()} disabled={changeReviewLoading}>{changeReviewLoading ? <Loader2 className="mr-2 animate-spin" size={15} /> : null}Check compatibility</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsShell>
  );
}
