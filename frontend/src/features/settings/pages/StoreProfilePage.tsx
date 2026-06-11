import { useEffect, useRef, useState } from "react";
import { getGetShopQueryKey, useUpdateShop } from "@/lib/api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/features/auth/AuthContext";
import { useSubscriptionSnapshot } from "@/features/subscription";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  BadgeCheck, Building2, CheckCircle2, FileText, Landmark, Loader2, MapPin,
  Navigation, QrCode, Receipt, Store, Upload, Clock,
} from "lucide-react";
import { SettingsShell } from "@/features/settings/SettingsShell";
import { Card, CardHead, Fld, Badge } from "@/features/settings/ui";
import { useSettingsPrefs } from "@/features/settings/use-settings-prefs";

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

const DEFAULT_BRANDING = { title: "", showGstin: true, showPhone: true, showAddress: true, showQr: true, footer: "Thank you for shopping with us!" };

export default function StoreProfilePage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { snapshot } = useSubscriptionSnapshot();
  const queryClient = useQueryClient();
  const { prefs, patch, shop, hydrated } = useSettingsPrefs();

  const sp = (prefs.storeProfile ?? {}) as Record<string, string>;
  const branding = { ...DEFAULT_BRANDING, ...((prefs.branding ?? {}) as Partial<typeof DEFAULT_BRANDING>) };
  const hours = (prefs.hours ?? {}) as Record<string, DayHours>;
  const bank = (prefs.bank ?? {}) as Record<string, string>;
  const docs = (prefs.docs ?? {}) as Record<string, string>;

  const [biz, setBiz] = useState({ name: "", ownerName: "", phone: "", altPhone: "", email: "", gstNumber: "", pan: "", businessType: "Kirana / General Store", currency: "₹ Indian Rupee" });
  const [addr, setAddr] = useState({ address: "", city: "", state: "", pincode: "", country: "India", deliveryRadius: "" });
  const seeded = useRef(false);

  const updateShop = useUpdateShop({
    mutation: {
      onSuccess: () => { queryClient.invalidateQueries({ queryKey: getGetShopQueryKey() }); toast({ title: "Store details saved" }); },
      onError: (err: unknown) => toast({ title: "Could not save", description: (err as { data?: { message?: string } })?.data?.message ?? "Try again", variant: "destructive" }),
    },
  });

  useEffect(() => {
    if (seeded.current || !hydrated || !shop) return;
    seeded.current = true;
    setBiz({
      name: shop.name ?? "", ownerName: shop.ownerName ?? "", phone: shop.phone ?? "",
      altPhone: sp.altPhone ?? "", email: sp.email ?? user?.email ?? "", gstNumber: shop.gstNumber ?? "",
      pan: sp.pan ?? "", businessType: sp.businessType ?? "Kirana / General Store", currency: sp.currency ?? "₹ Indian Rupee",
    });
    setAddr({
      address: shop.address ?? "", city: shop.city ?? "", state: sp.state ?? "",
      pincode: sp.pincode ?? "", country: sp.country ?? "India", deliveryRadius: sp.deliveryRadius ?? "",
    });
  }, [hydrated, shop, sp, user?.email]);

  function saveStoreDetails() {
    updateShop.mutate({ data: { name: biz.name, ownerName: biz.ownerName, phone: biz.phone, gstNumber: biz.gstNumber, address: addr.address, city: addr.city } });
    patch({ storeProfile: { ...sp, altPhone: biz.altPhone, email: biz.email, pan: biz.pan, businessType: biz.businessType, currency: biz.currency, state: addr.state, pincode: addr.pincode, country: addr.country, deliveryRadius: addr.deliveryRadius } });
  }

  const setBrand = (key: keyof typeof DEFAULT_BRANDING, val: string | boolean) => patch({ branding: { ...branding, [key]: val } });
  const setDay = (day: string, next: DayHours) => patch({ hours: { ...hours, [day]: next } });
  const setBank = (key: string, val: string) => patch({ bank: { ...bank, [key]: val } });

  function useCurrentLocation() {
    if (!navigator.geolocation) { toast({ title: "Location not supported", variant: "destructive" }); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { patch({ storeProfile: { ...sp, geo: `${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)}` } }); toast({ title: "Location captured", description: "Saved to your store profile." }); },
      () => toast({ title: "Couldn't get location", description: "Allow location access and try again.", variant: "destructive" }),
    );
  }
  function openInMaps() {
    const q = encodeURIComponent([addr.address, addr.city, addr.state, addr.pincode].filter(Boolean).join(", ") || "my shop");
    window.open(`https://www.google.com/maps/search/?api=1&query=${q}`, "_blank", "noopener");
  }
  function markDocUploaded(key: string) {
    patch({ docs: { ...docs, [key]: "uploaded" } });
    toast({ title: "Document marked uploaded", description: "Verification is completed by our team after review." });
  }

  const storeId = shop?.id ? `KRN-${String(shop.id).slice(-6).toUpperCase()}` : "—";
  const planName = snapshot?.planCode ? snapshot.planCode.charAt(0).toUpperCase() + snapshot.planCode.slice(1) : "Free";

  return (
    <SettingsShell>
      {/* Store Identity Hero */}
      <Card>
        <div className="flex flex-col gap-4 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <span className="grid h-[76px] w-[76px] shrink-0 place-items-center rounded-[16px] bg-[#eef5ff] text-4xl">🏪</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="font-display text-[20px] font-black tracking-tight text-[#0f1e3d]">{biz.name || shop?.name || "My Store"}</h2>
                <Badge tone="green"><BadgeCheck size={12} /> Verified</Badge>
                <Badge tone="amber">{planName} Plan</Badge>
              </div>
              <p className="mt-0.5 text-[12px] text-[#52627e]">{biz.businessType} · Store ID {storeId}</p>
              <p className="text-[12px] text-[#52627e]">{[addr.address, addr.city].filter(Boolean).join(", ") || "Add your store address"}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" className="h-10 gap-2 rounded-[10px] font-bold" onClick={() => toast({ title: "Logo upload coming soon", description: "Add your shop logo from a future update." })}><Upload size={15} /> Upload Logo</Button>
            <Button onClick={saveStoreDetails} disabled={updateShop.isPending} style={{ background: "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" }} className="h-10 gap-2 rounded-[10px] font-black text-white hover:opacity-95">
              {updateShop.isPending ? <Loader2 size={15} className="animate-spin" /> : <Store size={15} />} Save Profile
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Business Details */}
        <Card>
          <CardHead icon={<Building2 size={15} />} title="Business Details" sub="Legal & contact information" />
          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            <Fld label="Business Name"><Input className="h-10" value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} /></Fld>
            <Fld label="Owner Name"><Input className="h-10" value={biz.ownerName} onChange={(e) => setBiz({ ...biz, ownerName: e.target.value })} /></Fld>
            <Fld label="Phone Number"><Input className="h-10" value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} /></Fld>
            <Fld label="Alternate Phone"><Input className="h-10" value={biz.altPhone} onChange={(e) => setBiz({ ...biz, altPhone: e.target.value })} /></Fld>
            <Fld label="Email"><Input className="h-10" value={biz.email} onChange={(e) => setBiz({ ...biz, email: e.target.value })} /></Fld>
            <Fld label="GSTIN"><Input className="h-10" value={biz.gstNumber} onChange={(e) => setBiz({ ...biz, gstNumber: e.target.value })} /></Fld>
            <Fld label="PAN Number"><Input className="h-10" value={biz.pan} onChange={(e) => setBiz({ ...biz, pan: e.target.value })} /></Fld>
            <Fld label="Business Type">
              <Select value={biz.businessType} onValueChange={(v) => setBiz({ ...biz, businessType: v })}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>{["Kirana / General Store", "Supermarket", "Wholesale", "Pharmacy", "Restaurant", "Other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </Fld>
          </div>
        </Card>

        {/* Address & Location */}
        <Card>
          <CardHead icon={<MapPin size={15} />} title="Address & Location" sub="Shop address & delivery area" action={<button onClick={openInMaps} className="text-[12px] font-bold text-[#005dff] hover:underline">Open in Maps</button>} />
          <div className="space-y-3 px-5 pb-5">
            <Fld label="Shop Address"><Input className="h-10" value={addr.address} onChange={(e) => setAddr({ ...addr, address: e.target.value })} /></Fld>
            <div className="grid grid-cols-2 gap-3">
              <Fld label="City"><Input className="h-10" value={addr.city} onChange={(e) => setAddr({ ...addr, city: e.target.value })} /></Fld>
              <Fld label="State"><Input className="h-10" value={addr.state} onChange={(e) => setAddr({ ...addr, state: e.target.value })} /></Fld>
              <Fld label="Pincode"><Input className="h-10" value={addr.pincode} onChange={(e) => setAddr({ ...addr, pincode: e.target.value })} /></Fld>
              <Fld label="Country"><Input className="h-10" value={addr.country} onChange={(e) => setAddr({ ...addr, country: e.target.value })} /></Fld>
            </div>
            <div className="flex items-center gap-3 rounded-[10px] border border-[#dbe6f7] bg-[#f3f8ff] px-3 py-3">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-white text-[#005dff] shadow-sm"><MapPin size={16} /></span>
              <p className="flex-1 text-[11px] font-medium text-[#34507f]">{sp.geo ? `Pinned at ${sp.geo}` : "Pin your exact shop location for delivery & maps."}</p>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 rounded-[8px] text-[12px] font-bold" onClick={useCurrentLocation}><Navigation size={13} /> Use current</Button>
            </div>
            <Fld label="Delivery Radius (km)" hint="Used for local delivery suggestions"><Input className="h-10" value={addr.deliveryRadius} onChange={(e) => setAddr({ ...addr, deliveryRadius: e.target.value })} placeholder="e.g. 3" /></Fld>
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Bill Branding */}
        <Card>
          <CardHead icon={<Receipt size={15} />} title="Bill Branding" sub="How your receipt looks" />
          <div className="grid gap-4 px-5 pb-5 sm:grid-cols-[1fr_180px]">
            <div className="space-y-3">
              <Fld label="Bill Title"><Input className="h-10" value={branding.title} placeholder={biz.name || "Store name"} onChange={(e) => setBrand("title", e.target.value)} /></Fld>
              <div className="space-y-1">
                {([["showGstin", "Show GSTIN"], ["showPhone", "Show phone"], ["showAddress", "Show address"], ["showQr", "Show payment QR"]] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between rounded-[8px] border border-[#eef2f8] px-3 py-2">
                    <span className="text-[12px] font-semibold text-[#344668]">{label}</span>
                    <Switch checked={Boolean(branding[key])} onCheckedChange={(v) => setBrand(key, v)} />
                  </label>
                ))}
              </div>
              <Fld label="Footer Message"><Input className="h-10" value={branding.footer} onChange={(e) => setBrand("footer", e.target.value)} /></Fld>
            </div>
            {/* mini receipt preview */}
            <div className="rounded-[10px] border border-dashed border-[#cdd9ec] bg-[#fbfdff] p-3">
              <div className="mx-auto w-full rounded-[6px] bg-white p-2.5 text-center shadow-sm" style={{ fontFamily: "monospace" }}>
                <p className="truncate text-[12px] font-black uppercase text-[#0f1e3d]">{branding.title || biz.name || "MY STORE"}</p>
                {branding.showAddress && <p className="truncate text-[8px] text-[#64748b]">{addr.city || "City"}</p>}
                {branding.showPhone && biz.phone && <p className="text-[8px] text-[#64748b]">Ph: {biz.phone}</p>}
                {branding.showGstin && biz.gstNumber && <p className="truncate text-[8px] text-[#64748b]">GST: {biz.gstNumber}</p>}
                <div className="my-1.5 border-t border-dashed border-[#cbd5e1]" />
                <div className="flex justify-between text-[8px] text-[#334155]"><span>Item x1</span><span>Rs 40</span></div>
                <div className="flex justify-between text-[8px] font-bold text-[#0f1e3d]"><span>Total</span><span>Rs 40</span></div>
                {branding.showQr && <div className="mx-auto mt-1.5 grid h-9 w-9 place-items-center rounded bg-[#f1f5f9] text-[#94a3b8]"><QrCode size={20} /></div>}
                <div className="my-1.5 border-t border-dashed border-[#cbd5e1]" />
                <p className="truncate text-[8px] text-[#64748b]">{branding.footer}</p>
              </div>
            </div>
          </div>
        </Card>

        {/* Operating Hours */}
        <Card>
          <CardHead icon={<Clock size={15} />} title="Operating Hours" sub="Set open & close times" />
          <div className="px-5 pb-5">
            {DAYS.map((day) => {
              const h = hours[day] ?? DEFAULT_DAY;
              return (
                <div key={day} className="flex items-center gap-3 border-b border-[#eef2f8] py-2 last:border-0">
                  <span className="w-[84px] shrink-0 text-[12px] font-bold text-[#102347]">{day}</span>
                  <Switch checked={h.open} onCheckedChange={(v) => setDay(day, { ...h, open: v })} />
                  {h.open ? (
                    <div className="flex flex-1 items-center justify-end gap-1.5">
                      <Input className="h-8 w-[88px] text-[12px]" type="time" value={h.from} onChange={(e) => setDay(day, { ...h, from: e.target.value })} />
                      <span className="text-[11px] text-[#94a3b8]">to</span>
                      <Input className="h-8 w-[88px] text-[12px]" type="time" value={h.to} onChange={(e) => setDay(day, { ...h, to: e.target.value })} />
                    </div>
                  ) : <span className="flex-1 text-right text-[12px] font-semibold text-[#94a3b8]">Closed</span>}
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
          <div className="grid grid-cols-2 gap-3 px-5 pb-5">
            <div className="col-span-2"><Fld label="UPI ID"><Input className="h-10" value={bank.upi ?? ""} placeholder="store@upi" onChange={(e) => setBank("upi", e.target.value)} /></Fld></div>
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
              const status = docs[d.key] ?? "missing";
              return (
                <div key={d.key} className="flex items-center gap-3 border-b border-[#eef2f8] py-2.5 last:border-0">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-[8px] bg-[#f4f7fb] text-[#536583]"><FileText size={14} /></span>
                  <span className="flex-1 truncate text-[13px] font-bold text-[#102347]">{d.label}</span>
                  {status === "uploaded"
                    ? <Badge tone="green"><CheckCircle2 size={11} /> Uploaded</Badge>
                    : <Badge tone="amber">Missing</Badge>}
                  <Button size="sm" variant="outline" className="h-8 rounded-[8px] text-[12px] font-bold" onClick={() => markDocUploaded(d.key)}>Upload</Button>
                </div>
              );
            })}
            <p className="mt-2 text-[11px] text-[#9aa6bb]">Documents are reviewed by our team for the verified badge.</p>
          </div>
        </Card>
      </div>

      <div className="flex justify-end pb-2">
        <Button onClick={saveStoreDetails} disabled={updateShop.isPending} style={{ background: "linear-gradient(180deg,#005dff 0%,#0047e8 100%)" }} className="h-11 gap-2 rounded-[10px] px-6 font-black text-white hover:opacity-95">
          {updateShop.isPending ? <><Loader2 size={16} className="animate-spin" /> Saving…</> : <><CheckCircle2 size={16} /> Save All Changes</>}
        </Button>
      </div>
    </SettingsShell>
  );
}
