import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { formatDistanceToNow } from "date-fns";
import { Ban, CheckCircle2, Clock3, Laptop, MonitorSmartphone, Pencil, RefreshCcw, ShieldCheck, Smartphone, Trash2, Wifi, WifiOff } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader, PageShell, StatCard, StatsGrid } from "@/components/shared";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionSnapshot, PlanBadge } from "@/features/subscription";
import { blockDevice, listDevices, reactivateDevice, removeDevice, renameDevice, type DeviceDto, type DeviceManagementSnapshot } from "@/features/devices/api";
import { getOfflineScope } from "@/lib/offline/context";
import { listCachedDevices } from "@/features/devices/license";

type ProtectedAction = "remove" | "block" | "reactivate";

function relative(value?: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatDistanceToNow(date, { addSuffix: true }) : "Unknown";
}

function fullDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })
    : "Not available";
}

function deviceIdOf(device: DeviceDto) {
  return device.deviceId || device.device_id || device.id;
}

function deviceNameOf(device: DeviceDto) {
  return device.deviceName || device.device_name || "Registered device";
}

function statusOf(device: DeviceDto) {
  return String(device.status || "active").toLowerCase() === "removed" ? "revoked" : String(device.status || "active").toLowerCase();
}

function DeviceIcon({ device }: { device: DeviceDto }) {
  const type = String(device.deviceType || device.device_name || "").toLowerCase();
  if (type.includes("mobile") || type.includes("phone")) return <Smartphone className="h-5 w-5" />;
  if (type.includes("tablet")) return <MonitorSmartphone className="h-5 w-5" />;
  return <Laptop className="h-5 w-5" />;
}

function statusStyle(status: string) {
  if (status === "active") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "logged_out") return "border-slate-200 bg-slate-50 text-slate-700";
  if (status === "blocked") return "border-rose-200 bg-rose-50 text-rose-700";
  return "border-amber-200 bg-amber-50 text-amber-800";
}

export default function DevicesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const { snapshot: subscription } = useSubscriptionSnapshot();
  const currentDeviceId = useMemo(() => getOfflineScope().device_id, []);
  const [data, setData] = useState<DeviceManagementSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineFallback, setOfflineFallback] = useState(false);
  const [actionTarget, setActionTarget] = useState<DeviceDto | null>(null);
  const [actionKind, setActionKind] = useState<ProtectedAction | null>(null);
  const [ownerPin, setOwnerPin] = useState("");
  const [renaming, setRenaming] = useState<DeviceDto | null>(null);
  const [deviceName, setDeviceName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const snapshot = await listDevices();
      setData(snapshot);
      setOfflineFallback(false);
    } catch {
      const cached = await listCachedDevices().catch(() => []);
      const maxDevices = subscription?.plan.maxDevices ?? 1;
      const devices: DeviceDto[] = cached.map((device) => ({
        id: device.id,
        deviceId: device.device_id,
        deviceName: device.device_name,
        status: device.status,
        lastSeenAt: device.last_active_at,
        lastSyncAt: device.last_active_at,
        isCurrentDevice: device.device_id === currentDeviceId,
        activity: "offline",
      }));
      setData({
        plan: { code: subscription?.planCode ?? "starter", name: subscription?.plan.name, deviceLimit: maxDevices },
        devicesUsed: devices.filter((device) => ["active", "logged_out", "blocked"].includes(statusOf(device))).length,
        remainingSlots: Math.max(0, maxDevices - devices.length),
        overLimit: devices.length > maxDevices,
        devices,
      });
      setOfflineFallback(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [currentDeviceId, subscription]);

  useEffect(() => { void refresh(true); }, [refresh]);

  function openProtectedAction(device: DeviceDto, action: ProtectedAction) {
    setActionTarget(device);
    setActionKind(action);
    setOwnerPin("");
  }

  async function submitProtectedAction() {
    if (!actionTarget || !actionKind || !/^\d{4}$/.test(ownerPin)) return;
    const id = deviceIdOf(actionTarget);
    setSubmitting(true);
    try {
      if (actionKind === "remove") await removeDevice(id, ownerPin);
      else if (actionKind === "block") await blockDevice(id, ownerPin);
      else await reactivateDevice(id, ownerPin);
      toast({ title: actionKind === "remove" ? "Device removed" : actionKind === "block" ? "Device blocked" : "Device can register again" });
      setActionTarget(null);
      setActionKind(null);
      setOwnerPin("");
      await refresh(true);
    } catch (error) {
      toast({ title: "Action could not be completed", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  async function submitRename() {
    if (!renaming || !deviceName.trim()) return;
    setSubmitting(true);
    try {
      await renameDevice(deviceIdOf(renaming), deviceName.trim());
      setRenaming(null);
      setDeviceName("");
      toast({ title: "Device renamed" });
      await refresh(true);
    } catch (error) {
      toast({ title: "Could not rename device", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  const devices = data?.devices ?? [];
  const content = (
    <>
      <PageHeader
        title="Devices"
        description="Registered phones, computers, and counters that can access this shop."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {subscription ? <PlanBadge planCode={subscription.planCode} status={subscription.status} /> : null}
            <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={refreshing}>
              <RefreshCcw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />Refresh
            </Button>
          </div>
        }
      />

      {offlineFallback ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <WifiOff className="h-4 w-4" />
          <AlertTitle>Showing the last saved device list</AlertTitle>
          <AlertDescription>Reconnect before renaming, blocking, or removing a device. Local business records remain available.</AlertDescription>
        </Alert>
      ) : null}

      <StatsGrid>
        <StatCard label="Current plan" value={data?.plan.name || data?.plan.code || "Starter"} description={`${data?.plan.deviceLimit ?? 1} registered device slots`} tone="blue" />
        <StatCard label="Devices used" value={`${data?.devicesUsed ?? 0} / ${data?.plan.deviceLimit ?? 1}`} description={data?.overLimit ? "Above current plan limit" : "Backend verified"} tone={data?.overLimit ? "red" : "green"} />
        <StatCard label="Slots remaining" value={String(data?.remainingSlots ?? 0)} description={(data?.remainingSlots ?? 0) > 0 ? "Ready for a new sign-in" : "All slots are in use"} tone={(data?.remainingSlots ?? 0) > 0 ? "green" : "amber"} />
        <StatCard label="This device" value={deviceNameOf(devices.find((device) => device.isCurrentDevice) ?? { id: currentDeviceId })} description="Current browser installation" />
      </StatsGrid>

      {(data?.remainingSlots ?? 0) === 0 ? (
        <Alert className="border-amber-200 bg-amber-50 text-amber-950">
          <Clock3 className="h-4 w-4" />
          <AlertTitle>All device slots are currently in use</AlertTitle>
          <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <span>Remove an old device or upgrade your subscription before another installation signs in.</span>
            <Button size="sm" onClick={() => setLocation("/plans")}>View upgrade options</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <section className="overflow-hidden rounded-lg border border-[#e1e8f2] bg-white">
        <div className="flex flex-col gap-2 border-b border-[#e8edf4] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-black text-[#102347]">Registered devices</h2>
            <p className="text-sm text-[#60708e]">Logging out keeps a slot. Removing a device frees it and revokes access immediately.</p>
          </div>
          <Badge variant="outline" className="w-fit">{devices.length} total</Badge>
        </div>

        <div className="divide-y divide-[#edf1f6]">
          {loading ? (
            <div className="p-8 text-center text-sm text-[#60708e]">Loading registered devices...</div>
          ) : devices.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#60708e]">No registered devices were returned by the shop account.</div>
          ) : devices.map((device) => {
            const id = deviceIdOf(device);
            const status = statusOf(device);
            const current = Boolean(device.isCurrentDevice || id === currentDeviceId);
            return (
              <article key={device.id || id} className="grid gap-4 p-4 transition-colors hover:bg-[#fbfcfe] lg:grid-cols-[minmax(220px,1.3fr)_minmax(170px,1fr)_minmax(160px,1fr)_auto] lg:items-center">
                <div className="flex min-w-0 gap-3">
                  <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#edf4ff] text-[#075fff]"><DeviceIcon device={device} /></div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="truncate font-black text-[#102347]">{deviceNameOf(device)}</h3>
                      {current ? <Badge className="bg-[#075fff] text-white">This device</Badge> : null}
                      <Badge variant="outline" className={statusStyle(status)}>{status.replace(/_/g, " ")}</Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-[#60708e]">{[device.browser, device.operatingSystem].filter(Boolean).join(" on ") || device.platform || "Web installation"}</p>
                    <p className="mt-1 text-[11px] text-[#8a97ab]">Registered {fullDate(device.registeredAt)}</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-1">
                  <div><p className="font-semibold text-[#8a97ab]">Last active</p><p className="mt-1 font-bold text-[#102347]">{relative(device.lastSeenAt || device.last_active_at)}</p></div>
                  <div><p className="font-semibold text-[#8a97ab]">Last login</p><p className="mt-1 font-bold text-[#102347]">{relative(device.lastLoginAt)}</p></div>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs lg:grid-cols-1">
                  <div><p className="font-semibold text-[#8a97ab]">Last user</p><p className="mt-1 font-bold text-[#102347]">{device.lastUserName || "Not available"}</p></div>
                  <div className="flex items-center gap-1.5 font-bold text-[#102347]">{device.activity === "online" ? <Wifi className="h-3.5 w-3.5 text-emerald-600" /> : <WifiOff className="h-3.5 w-3.5 text-[#94a3b8]" />}Last sync {relative(device.lastSyncAt)}</div>
                </div>

                <div className="flex flex-wrap gap-2 lg:justify-end">
                  <Button size="icon" variant="outline" title="Rename device" onClick={() => { setRenaming(device); setDeviceName(deviceNameOf(device)); }} disabled={offlineFallback}><Pencil className="h-4 w-4" /></Button>
                  {status === "blocked" ? (
                    <Button size="sm" variant="outline" onClick={() => openProtectedAction(device, "reactivate")} disabled={offlineFallback}><CheckCircle2 className="mr-1.5 h-4 w-4" />Reactivate</Button>
                  ) : (
                    <Button size="icon" variant="outline" title="Block device" onClick={() => openProtectedAction(device, "block")} disabled={offlineFallback || current || status === "revoked"}><Ban className="h-4 w-4" /></Button>
                  )}
                  <Button size="icon" variant="outline" title="Remove device" className="text-rose-600 hover:text-rose-700" onClick={() => openProtectedAction(device, "remove")} disabled={offlineFallback || current || status === "revoked"}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <Alert className="border-emerald-200 bg-emerald-50 text-emerald-950">
        <ShieldCheck className="h-4 w-4" />
        <AlertTitle>Device access is enforced by the backend</AlertTitle>
        <AlertDescription>Refresh tokens are rotated and hashed. Removing or blocking a device revokes its sessions; unsynced offline records are never automatically deleted.</AlertDescription>
      </Alert>

      <Dialog open={Boolean(renaming)} onOpenChange={(open) => { if (!open) setRenaming(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Rename device</DialogTitle><DialogDescription>Use a recognizable counter or staff-device name.</DialogDescription></DialogHeader>
          <div className="space-y-2"><Label htmlFor="device-name">Device name</Label><Input id="device-name" value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={120} /></div>
          <DialogFooter><Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button><Button onClick={() => void submitRename()} disabled={!deviceName.trim() || submitting}>{submitting ? "Saving..." : "Save name"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(actionTarget && actionKind)} onOpenChange={(open) => { if (!open) { setActionTarget(null); setActionKind(null); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{actionKind === "remove" ? `Remove “${actionTarget ? deviceNameOf(actionTarget) : "device"}”?` : actionKind === "block" ? "Block this device?" : "Allow this device to register again?"}</DialogTitle>
            <DialogDescription>{actionKind === "remove" ? "It will be logged out immediately and its slot will be freed. Unsynced data on that installation may require recovery." : actionKind === "block" ? "All sessions will be revoked immediately. A blocked device cannot sign in until reactivated." : "The device becomes eligible to register again when a plan slot is available."}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2"><Label htmlFor="device-owner-pin">Owner PIN</Label><Input id="device-owner-pin" type="password" inputMode="numeric" maxLength={4} value={ownerPin} onChange={(event) => setOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="4-digit PIN" /></div>
          <DialogFooter><Button variant="outline" onClick={() => { setActionTarget(null); setActionKind(null); }}>Cancel</Button><Button variant={actionKind === "reactivate" ? "default" : "destructive"} onClick={() => void submitProtectedAction()} disabled={ownerPin.length !== 4 || submitting}>{submitting ? "Working..." : actionKind === "remove" ? "Remove device" : actionKind === "block" ? "Block device" : "Reactivate device"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );

  return embedded ? <div className="space-y-4">{content}</div> : <PageShell>{content}</PageShell>;
}
