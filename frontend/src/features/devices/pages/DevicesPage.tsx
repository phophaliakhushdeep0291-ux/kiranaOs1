import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, Clock, Laptop, MonitorSmartphone, Plus, RefreshCcw, ShieldCheck, Smartphone, Trash2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionSnapshot, PlanBadge, UpgradeModal } from "@/features/subscription";
import { subscriptionRefreshLocalFirst } from "@/features/subscription/local-actions";
import { getOfflineScope } from "@/lib/offline/context";
import { addDeviceLocalFirst, removeDeviceLocalFirst } from "@/features/devices/local-actions";
import { createStarterOfflineLicense, ensureCurrentDeviceRegistered, evaluateOfflineLicenseToken, getLicenseEvaluation, listCachedDevices, readOfflineLicenseToken, writeOfflineLicenseToken, type DeviceRegistration, type LicenseEvaluation, type OfflineLicenseToken } from "@/features/devices/license";
import type { PlanCode } from "@/features/subscription/plans";
import { DataTableCard, PageHeader, PageShell, StatCard, StatsGrid } from "@/components/shared";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return `${date.toLocaleDateString("en-IN")} ${date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}`;
}

function formatRelative(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return formatDistanceToNow(date, { addSuffix: true });
}

function deviceStatusLabel(status: string, syncStatus?: string) {
  if (status === "active" && syncStatus === "synced") return { label: "Ready to use", tone: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (status === "remove_pending") return { label: "Removal waiting", tone: "bg-rose-50 text-rose-700 border-rose-200" };
  if (status === "pending_activation") return { label: "Waiting for approval", tone: "bg-amber-50 text-amber-700 border-amber-200" };
  if (syncStatus === "pending_sync") return { label: "Backup pending", tone: "bg-amber-50 text-amber-700 border-amber-200" };
  if (syncStatus === "failed") return { label: "Needs sync retry", tone: "bg-rose-50 text-rose-700 border-rose-200" };
  return { label: status.replace(/_/g, " "), tone: "bg-slate-50 text-slate-700 border-slate-200" };
}

function deviceIcon(device: DeviceRegistration) {
  const name = device.device_name.toLowerCase();
  if (name.includes("phone") || name.includes("mobile")) return <Smartphone className="h-5 w-5" />;
  if (name.includes("counter") || name.includes("pos")) return <MonitorSmartphone className="h-5 w-5" />;
  return <Laptop className="h-5 w-5" />;
}

function licenseTone(evaluation: LicenseEvaluation) {
  if (evaluation.state === "valid") return "border-green-200 bg-green-50 text-green-900";
  if (evaluation.state === "grace") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-red-200 bg-red-50 text-red-900";
}

export default function DevicesPage({ embedded = false }: { embedded?: boolean } = {}) {
  const { toast } = useToast();
  const { snapshot, refresh: refreshSubscription } = useSubscriptionSnapshot();
  const [devices, setDevices] = useState<DeviceRegistration[]>([]);
  const [license, setLicense] = useState<OfflineLicenseToken | null>(null);
  const [evaluation, setEvaluation] = useState<LicenseEvaluation>(() => evaluateOfflineLicenseToken(null));
  const [loading, setLoading] = useState(true);
  const [newDeviceName, setNewDeviceName] = useState("");
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<DeviceRegistration | null>(null);
  const [ownerPin, setOwnerPin] = useState("");
  const [upgradePlan, setUpgradePlan] = useState<PlanCode | null>(null);

  const scope = useMemo(() => getOfflineScope(), []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      await ensureCurrentDeviceRegistered();
      const [cachedLicense, currentEvaluation, cachedDevices] = await Promise.all([
        readOfflineLicenseToken(),
        getLicenseEvaluation(),
        listCachedDevices(),
      ]);
      setLicense(cachedLicense);
      setEvaluation(currentEvaluation);
      setDevices(cachedDevices);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    window.addEventListener("kirana:local-data-changed", handler);
    window.addEventListener("kirana:sync-queue-updated", handler);
    return () => {
      window.removeEventListener("kirana:local-data-changed", handler);
      window.removeEventListener("kirana:sync-queue-updated", handler);
    };
  }, [refresh]);

  const activeDevices = devices.filter((device) => device.status === "active" || device.status === "pending_activation");
  const maxDevices = evaluation.token?.max_devices ?? snapshot?.plan.maxDevices ?? 1;
  const currentDevice = devices.find((device) => device.is_current_device) ?? null;
  const limitReached = activeDevices.length >= maxDevices;
  const canRemove = devices.some((device) => device.status !== "remove_pending" && !device.is_current_device);

  async function handleAddDevice() {
    if (limitReached) {
      setUpgradePlan(snapshot?.planCode === "pro" ? "pro" : snapshot?.planCode === "starter" ? "standard" : snapshot?.planCode === "standard" ? "growth" : "pro");
      toast({ title: "Device limit reached", description: `Your current plan allows ${maxDevices} device${maxDevices > 1 ? "s" : ""}. Upgrade to add more.` });
      return;
    }
    setAdding(true);
    try {
      await addDeviceLocalFirst(newDeviceName);
      setNewDeviceName("");
      await refresh();
      toast({ title: "Device activation request saved", description: "Backend must finally approve and enforce device access. This request will sync when cloud backup is available." });
    } catch (error) {
      toast({ title: "Could not add device", description: error instanceof Error ? error.message : "Please check the device name.", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveDevice() {
    if (!removeTarget) return;
    try {
      await removeDeviceLocalFirst(removeTarget.id, ownerPin);
      setRemoveTarget(null);
      setOwnerPin("");
      await refresh();
      toast({ title: "Remove request saved", description: "Device removal is pending cloud sync. Old data stays viewable." });
    } catch (error) {
      toast({ title: "Owner PIN required", description: error instanceof Error ? error.message : "Enter owner PIN to remove a device.", variant: "destructive" });
    }
  }

  async function refreshLicense() {
    setRefreshing(true);
    try {
      await subscriptionRefreshLocalFirst(snapshot?.planCode ?? evaluation.plan);
      await refreshSubscription();
      await refresh();
      toast({ title: "License refresh queued", description: "Cached license will update after backend confirms subscription/device status." });
    } finally {
      setRefreshing(false);
    }
  }

  async function seedStarterLicenseForThisDevice() {
    const token = createStarterOfflineLicense();
    await writeOfflineLicenseToken(token, "starter-local-fallback");
    await refresh();
    toast({ title: "Starter offline license cached", description: "This is only a local fallback for UX. Backend must still enforce real subscription security." });
  }

  if (loading) {
    const loadingCard = <DataTableCard title="Devices" loading>Loading devices...</DataTableCard>;
    return embedded ? loadingCard : <PageShell>{loadingCard}</PageShell>;
  }

  const content = (
    <>
      <PageHeader
        title="Device Management"
        description="See which phones, laptops, and counters can use this shop account."
        actions={snapshot ? <PlanBadge planCode={snapshot.planCode} status={snapshot.status} /> : null}
      />

      <Alert className={licenseTone(evaluation)}>
        {evaluation.state === "valid" ? <ShieldCheck className="h-4 w-4" /> : evaluation.state === "grace" ? <Clock className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        <AlertTitle>{evaluation.state === "valid" ? "This shop can work offline" : evaluation.state === "grace" ? "Offline access is in grace period" : "Device access needs attention"}</AlertTitle>
        <AlertDescription>{evaluation.message}</AlertDescription>
      </Alert>

      <StatsGrid>
        <StatCard label="This device" value={currentDevice?.device_name ?? "Current device"} description="Signed in here" tone="blue" />
        <StatCard label="Devices in use" value={`${activeDevices.length} / ${maxDevices}`} description={limitReached ? "Plan limit reached" : "Can add more"} tone={limitReached ? "red" : "green"} />
        <StatCard label="Access valid until" value={formatDateTime(evaluation.validUntil)} description={formatRelative(evaluation.validUntil)} />
        <StatCard label="Offline safety" value={evaluation.state === "valid" ? "Ready" : evaluation.state === "grace" ? "Grace" : "Check"} description={formatRelative(evaluation.offlineGraceUntil)} tone={evaluation.state === "expired" ? "red" : "amber"} />
      </StatsGrid>

      {limitReached && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Device limit reached</AlertTitle>
          <AlertDescription>Your plan allows {maxDevices} active device{maxDevices > 1 ? "s" : ""}. Remove an old device or upgrade before adding another one.</AlertDescription>
        </Alert>
      )}

      {evaluation.state === "expired" && (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertTitle>Refresh device access</AlertTitle>
          <AlertDescription>You can still view old data. Connect to internet and refresh access to continue cloud sync and billing actions.</AlertDescription>
        </Alert>
      )}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Shop devices</CardTitle>
            <CardDescription>Use simple names like Counter laptop, Owner phone, or Staff tablet.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {devices.length === 0 ? (
                <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No devices found yet. This device will appear after the next refresh.</div>
              ) : devices.map((device) => {
                const status = deviceStatusLabel(device.status, device.sync_status);
                return (
                  <div key={device.id} className="flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-[0_8px_24px_rgba(15,23,42,0.04)] sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-50 text-blue-600">{deviceIcon(device)}</div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate text-sm font-bold text-[#102347]">{device.device_name || "Shop device"}</p>
                          {device.is_current_device && <Badge variant="outline" className="border-blue-200 bg-blue-50 text-blue-700">This device</Badge>}
                          <Badge variant="outline" className={status.tone}>{status.label}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-[#64748b]">Last used {formatRelative(device.last_active_at)}</p>
                        <details className="mt-1 text-[11px] text-[#8a97ab]">
                          <summary className="cursor-pointer select-none">Technical details</summary>
                          <p className="mt-1 break-all">Device ID: {device.device_id}</p>
                          <p>Backup: {device.sync_status.replace(/_/g, " ")}</p>
                        </details>
                      </div>
                    </div>
                    <Button size="sm" variant="outline" className="self-start sm:self-center" disabled={device.is_current_device || device.status === "remove_pending"} onClick={() => setRemoveTarget(device)}>
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove
                    </Button>
                  </div>
                );
              })}
            </div>
            {!canRemove && devices.length > 1 && <p className="mt-3 text-xs text-muted-foreground">The current device cannot remove itself. Open this page on another owner device to remove it.</p>}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Add a new device</CardTitle>
              <CardDescription>Name the phone, laptop, or counter before using it for billing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Counter 2 laptop / Owner phone" value={newDeviceName} onChange={(event) => setNewDeviceName(event.target.value)} />
              <Button className="w-full max-w-full whitespace-normal" onClick={() => void handleAddDevice()} disabled={adding || newDeviceName.trim().length < 2 || limitReached}>
                <Plus className="mr-1.5 h-4 w-4" />{adding ? "Saving..." : "Add device"}
              </Button>
              {limitReached && <Button variant="outline" className="w-full max-w-full whitespace-normal" onClick={() => setUpgradePlan(snapshot?.planCode === "starter" ? "standard" : snapshot?.planCode === "standard" ? "growth" : "pro")}>Upgrade for more devices</Button>}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Device access</CardTitle>
              <CardDescription>Refresh when a plan changes or a device was added from another counter.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-xl border bg-slate-50/70 p-3"><p className="text-muted-foreground">Current plan</p><p className="font-bold capitalize text-[#102347]">{evaluation.plan}</p></div>
                <div className="rounded-xl border bg-slate-50/70 p-3"><p className="text-muted-foreground">Allowed devices</p><p className="font-bold text-[#102347]">{maxDevices}</p></div>
                <div className="rounded-xl border bg-slate-50/70 p-3"><p className="text-muted-foreground">Valid until</p><p className="font-bold text-[#102347]">{formatDateTime(evaluation.validUntil)}</p></div>
                <div className="rounded-xl border bg-slate-50/70 p-3"><p className="text-muted-foreground">Offline backup window</p><p className="font-bold text-[#102347]">{formatRelative(evaluation.offlineGraceUntil)}</p></div>
              </div>
              <div className="flex flex-col gap-2">
                <Button variant="outline" className="w-full max-w-full whitespace-normal" onClick={() => void refreshLicense()} disabled={refreshing}><RefreshCcw className="mr-1.5 h-4 w-4" />{refreshing ? "Refreshing..." : "Refresh device access"}</Button>
                {!license && <Button variant="secondary" className="w-full max-w-full whitespace-normal" onClick={() => void seedStarterLicenseForThisDevice()}>Enable starter access on this device</Button>}
              </div>
              <details className="rounded-xl border bg-white p-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer select-none font-semibold text-[#102347]">Technical details</summary>
                <div className="mt-2 space-y-1">
                  <p className="break-all">Tenant: {license?.tenant_id ?? scope.tenant_id}</p>
                  <p className="break-all">Store: {license?.store_id ?? scope.store_id}</p>
                  <p className="break-all">This device: {scope.device_id}</p>
                </div>
              </details>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={removeTarget !== null} onOpenChange={(open) => { if (!open) { setRemoveTarget(null); setOwnerPin(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove this device?</DialogTitle>
            <DialogDescription>This will stop the selected device from being used for this shop after sync. Business data is not deleted.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="rounded-lg border p-3 text-sm">
              <p className="font-medium">{removeTarget?.device_name}</p>
              <p className="break-all text-muted-foreground">{removeTarget?.device_id}</p>
            </div>
            <Input type="password" placeholder="Owner PIN" value={ownerPin} onChange={(event) => setOwnerPin(event.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setRemoveTarget(null); setOwnerPin(""); }}>Cancel</Button>
            <Button variant="destructive" onClick={() => void handleRemoveDevice()} disabled={ownerPin.trim().length < 4}>Remove device</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <UpgradeModal open={upgradePlan !== null} onOpenChange={(open) => !open && setUpgradePlan(null)} targetPlanCode={upgradePlan ?? undefined} reason="Your current plan has reached its device limit." />
    </>
  );

  if (embedded) return <div className="space-y-5">{content}</div>;

  return <PageShell className="space-y-6">{content}</PageShell>;
}
