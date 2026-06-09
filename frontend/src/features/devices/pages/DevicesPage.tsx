import { useCallback, useEffect, useMemo, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, Clock, Laptop, Plus, RefreshCcw, ShieldCheck, Trash2, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionSnapshot, PlanBadge, UpgradeModal } from "@/features/subscription";
import { subscriptionRefreshLocalFirst } from "@/features/subscription/local-actions";
import { getOfflineScope } from "@/lib/offline/context";
import { addDeviceLocalFirst, removeDeviceLocalFirst } from "@/features/devices/local-actions";
import { createStarterOfflineLicense, ensureCurrentDeviceRegistered, evaluateOfflineLicenseToken, getLicenseEvaluation, listCachedDevices, readOfflineLicenseToken, writeOfflineLicenseToken, type DeviceRegistration, type LicenseEvaluation, type OfflineLicenseToken } from "@/features/devices/license";
import type { PlanCode } from "@/features/subscription/plans";
import { DataTableCard, EmptyState, PageHeader, PageShell, StatCard, StatsGrid, SyncBadge } from "@/components/shared";

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

function statusBadge(status: string, syncStatus?: string) {
  if (status === "active" && syncStatus === "synced") return <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />Active</Badge>;
  if (status === "remove_pending") return <Badge variant="destructive">Remove pending</Badge>;
  if (status === "pending_activation") return <Badge variant="secondary">Activation pending</Badge>;
  if (syncStatus === "pending_sync") return <Badge variant="outline">Cloud backup pending</Badge>;
  if (syncStatus === "failed") return <Badge variant="destructive">Sync failed</Badge>;
  return <Badge variant="outline" className="capitalize">{status.replace(/_/g, " ")}</Badge>;
}

function licenseTone(evaluation: LicenseEvaluation) {
  if (evaluation.state === "valid") return "border-green-200 bg-green-50 text-green-900";
  if (evaluation.state === "grace") return "border-amber-200 bg-amber-50 text-amber-900";
  return "border-red-200 bg-red-50 text-red-900";
}

export default function DevicesPage() {
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

  if (loading) return <PageShell><DataTableCard title="Devices" loading>Loading devices...</DataTableCard></PageShell>;

  return (
    <PageShell className="space-y-6">
      <PageHeader
        title="Devices"
        description="Manage billing devices, offline license cache and device limits."
        actions={snapshot ? <PlanBadge planCode={snapshot.planCode} status={snapshot.status} /> : null}
      />

      <Alert className={licenseTone(evaluation)}>
        {evaluation.state === "valid" ? <ShieldCheck className="h-4 w-4" /> : evaluation.state === "grace" ? <Clock className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
        <AlertTitle>{evaluation.state === "valid" ? "Offline license active" : evaluation.state === "grace" ? "Offline grace active" : "License attention needed"}</AlertTitle>
        <AlertDescription>{evaluation.message} Backend security still has final control; frontend license is only for offline UX guidance.</AlertDescription>
      </Alert>

      <StatsGrid>
        <StatCard label="Current device" value={currentDevice?.device_name ?? "This device"} description={scope.device_id} tone="blue" />
        <StatCard label="Plan device limit" value={`${activeDevices.length} / ${maxDevices}`} description={limitReached ? "Limit reached" : "Space available"} tone={limitReached ? "red" : "green"} />
        <StatCard label="License valid until" value={formatDateTime(evaluation.validUntil)} description={formatRelative(evaluation.validUntil)} />
        <StatCard label="Offline grace until" value={formatDateTime(evaluation.offlineGraceUntil)} description={formatRelative(evaluation.offlineGraceUntil)} tone="amber" />
      </StatsGrid>

      {limitReached && (
        <Alert className="border-amber-200 bg-amber-50 text-amber-900">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Device limit warning</AlertTitle>
          <AlertDescription>Your plan allows {maxDevices} active device{maxDevices > 1 ? "s" : ""}. Add/remove device requests are visible here, but backend must finally enforce the device limit.</AlertDescription>
        </Alert>
      )}

      {evaluation.state === "expired" && (
        <Alert variant="destructive">
          <WifiOff className="h-4 w-4" />
          <AlertTitle>Local-only after grace expiry</AlertTitle>
          <AlertDescription>Old data is always viewable. New billing, cloud sync and premium actions are restricted until license/subscription refresh.</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Activated devices</CardTitle>
            <CardDescription>Last active time and sync status are read from local device/license cache, so this page works offline.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Device</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Last active</TableHead>
                    <TableHead>Sync</TableHead>
                    <TableHead className="text-right">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {devices.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">No device cache found yet.</TableCell></TableRow>}
                  {devices.map((device) => (
                    <TableRow key={device.id}>
                      <TableCell>
                        <div className="flex items-center gap-2 font-medium"><Laptop className="h-4 w-4" />{device.device_name}{device.is_current_device && <Badge variant="outline">Current</Badge>}</div>
                        <p className="mt-1 break-all text-xs text-muted-foreground">{device.device_id}</p>
                      </TableCell>
                      <TableCell>{statusBadge(device.status, device.sync_status)}</TableCell>
                      <TableCell>{formatRelative(device.last_active_at)}</TableCell>
                      <TableCell><Badge variant={device.sync_status === "synced" ? "default" : "outline"}>{device.sync_status.replace(/_/g, " ")}</Badge></TableCell>
                      <TableCell className="text-right">
                        <Button size="sm" variant="outline" disabled={device.is_current_device || device.status === "remove_pending"} onClick={() => setRemoveTarget(device)}>
                          <Trash2 className="mr-1.5 h-3.5 w-3.5" />Remove
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!canRemove && devices.length > 1 && <p className="mt-2 text-xs text-muted-foreground">Current device cannot remove itself from offline UI. Use another owner device or backend admin panel.</p>}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Add device</CardTitle>
              <CardDescription>Creates a pending activation request. Real activation must be approved by backend.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input placeholder="Counter 2 laptop / Owner phone" value={newDeviceName} onChange={(event) => setNewDeviceName(event.target.value)} />
              <Button className="w-full" onClick={() => void handleAddDevice()} disabled={adding || newDeviceName.trim().length < 2 || limitReached}>
                <Plus className="mr-1.5 h-4 w-4" />{adding ? "Saving..." : "Add device request"}
              </Button>
              {limitReached && <Button variant="outline" className="w-full" onClick={() => setUpgradePlan(snapshot?.planCode === "starter" ? "standard" : snapshot?.planCode === "standard" ? "growth" : "pro")}>Upgrade for more devices</Button>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>License cache</CardTitle>
              <CardDescription>Offline token shape used by frontend.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border p-2"><p className="text-muted-foreground">Tenant</p><p className="break-all font-medium">{license?.tenant_id ?? scope.tenant_id}</p></div>
                <div className="rounded-lg border p-2"><p className="text-muted-foreground">Store</p><p className="break-all font-medium">{license?.store_id ?? scope.store_id}</p></div>
                <div className="rounded-lg border p-2"><p className="text-muted-foreground">Plan</p><p className="font-medium capitalize">{evaluation.plan}</p></div>
                <div className="rounded-lg border p-2"><p className="text-muted-foreground">Max devices</p><p className="font-medium">{maxDevices}</p></div>
              </div>
              <p className="text-xs text-muted-foreground">Token includes plan, features, max_devices, valid_until, offline_grace_until and signature. Signature is not backend security; backend must verify requests.</p>
              <div className="flex flex-col gap-2">
                <Button variant="outline" onClick={() => void refreshLicense()} disabled={refreshing}><RefreshCcw className="mr-1.5 h-4 w-4" />{refreshing ? "Queuing..." : "Refresh license"}</Button>
                {!license && <Button variant="secondary" onClick={() => void seedStarterLicenseForThisDevice()}>Cache Starter fallback</Button>}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={removeTarget !== null} onOpenChange={(open) => { if (!open) { setRemoveTarget(null); setOwnerPin(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove device?</DialogTitle>
            <DialogDescription>Removing a device needs owner permission. This creates a pending removal request and does not delete old business data.</DialogDescription>
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
    </PageShell>
  );
}
