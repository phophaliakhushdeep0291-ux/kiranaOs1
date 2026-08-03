import { useCallback, useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Activity, Loader2, MonitorSmartphone, ShieldX, SlidersHorizontal, Sparkles, Wrench } from "lucide-react";
import { PageHeader, PageShell } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ApiClientError } from "@/lib/api/http";
import {
  dispatchSupportCommand,
  endSupportSession,
  getRepairableSettings,
  getSupportCatalog,
  getSupportDiagnostics,
  redeemSupportCode,
  repairSetting,
  type OperatorDiagnostics,
  type RepairableSetting,
  type SupportCommandDefinition,
} from "@/features/platform-admin/api";
import type { SupportCommandType } from "@/features/remote-support/api";

/**
 * The operator's console: enter the code the shopkeeper read out, see that shop's
 * real diagnostics, run a fix, watch it land — all without leaving the desk.
 *
 * Everything shown here is assembled from the services the shop's own screens use,
 * so support and the owner are never looking at different numbers.
 */

function timeAgo(value?: string | null) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatDistanceToNow(date, { addSuffix: true }) : "unknown";
}

function readIncidentField(incident: Record<string, unknown> | null, key: string): string | null {
  const value = incident?.[key];
  return typeof value === "string" && value.trim() ? value : null;
}

function DeniedCard() {
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldX className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="text-lg font-bold">Platform admin only</h1>
      <p className="text-sm text-muted-foreground">
        The remote support console is limited to platform administrators.
      </p>
    </div>
  );
}

export default function RemoteSupportConsolePage() {
  const [code, setCode] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [data, setData] = useState<OperatorDiagnostics | null>(null);
  const [catalog, setCatalog] = useState<SupportCommandDefinition[]>([]);
  const [targetDevice, setTargetDevice] = useState<string>("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<RepairableSetting[]>([]);
  const [settingDrafts, setSettingDrafts] = useState<Record<string, string>>({});
  const [settingNotice, setSettingNotice] = useState<string | null>(null);

  useEffect(() => {
    getSupportCatalog()
      .then((result) => setCatalog(result.commands))
      .catch((err) => {
        if (err instanceof ApiClientError && err.status === 403) setDenied(true);
      });
  }, []);

  const refresh = useCallback(async (id: string, deviceId?: string) => {
    try {
      const next = await getSupportDiagnostics(id, { deviceId: deviceId || undefined });
      setData(next);
      setError(null);
      setTargetDevice((current) => current || next.devices[0]?.deviceId || "");
    } catch (err) {
      // The owner can revoke mid-call; when they do, say so plainly rather than
      // leaving a stale screen that looks like access is still live.
      setError(err instanceof ApiClientError ? err.message : "Could not load this shop's diagnostics.");
      if (err instanceof ApiClientError && err.status === 403) {
        setSessionId(null);
        setData(null);
      }
    }
  }, []);

  // Poll while connected: a fix's effect (sync counts falling, a device coming back
  // online) is the only real confirmation it worked.
  useEffect(() => {
    if (!sessionId) return;
    void refresh(sessionId, targetDevice);
    const timer = window.setInterval(() => void refresh(sessionId, targetDevice), 8_000);
    return () => window.clearInterval(timer);
  }, [sessionId, targetDevice, refresh]);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const result = await redeemSupportCode(code.trim());
      setSessionId(result.session.id);
      setCode("");
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 403) setDenied(true);
      else setError(err instanceof ApiClientError ? err.message : "Could not open that session.");
    } finally {
      setBusy(false);
    }
  }

  async function run(type: SupportCommandType) {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      await dispatchSupportCommand({
        sessionId,
        type,
        deviceId: targetDevice || undefined,
        reason: reason.trim() || undefined,
      });
      await refresh(sessionId, targetDevice);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not queue that command.");
    } finally {
      setBusy(false);
    }
  }

  const refreshSettings = useCallback(async (id: string) => {
    try {
      const result = await getRepairableSettings(id);
      setSettings(result.settings);
    } catch {
      // Non-fatal: the rest of the console is still useful without this card.
      setSettings([]);
    }
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    void refreshSettings(sessionId);
  }, [sessionId, refreshSettings]);

  async function applySetting(setting: RepairableSetting) {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    setSettingNotice(null);
    try {
      const result = await repairSetting({
        sessionId,
        key: setting.key,
        value: setting.input === "none" ? null : (settingDrafts[setting.key] ?? "").trim(),
        reason: reason.trim() || undefined,
      });
      setSettingDrafts((current) => ({ ...current, [setting.key]: "" }));
      setSettingNotice(
        `${result.label} updated.` +
          (result.nudgedDevices.length ? ` ${result.nudgedDevices.length} device(s) told to sync.` : ""),
      );
      await refreshSettings(sessionId);
      await refresh(sessionId, targetDevice);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not apply that setting.");
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!sessionId) return;
    setBusy(true);
    try {
      await endSupportSession(sessionId);
    } catch {
      // Already ended or revoked — either way this console is done with it.
    } finally {
      setSessionId(null);
      setData(null);
      setBusy(false);
    }
  }

  if (denied) return <DeniedCard />;

  const session = data?.session;
  const canRepair = session?.scope === "repair";
  const incident = data?.incident ?? null;

  return (
    <PageShell>
      <PageHeader
        title="Remote support console"
        description="Enter the code the shop owner read out. You will see that one shop, for as long as they allow it."
      />

      {error ? <p className="mb-4 text-sm text-destructive">{error}</p> : null}

      {!sessionId ? (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-lg">Connect to a shop</CardTitle>
            <CardDescription>Ask the owner to open Help → “Get remote help”.</CardDescription>
          </CardHeader>
          <CardContent className="flex gap-2">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              placeholder="6-digit code"
              inputMode="numeric"
              className="font-mono text-lg tracking-[0.2em]"
            />
            <Button onClick={() => void connect()} disabled={busy || code.length !== 6} className="gap-2">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
              Connect
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
              <div>
                <CardTitle className="text-lg">{data?.shop?.name ?? "Loading…"}</CardTitle>
                <CardDescription>
                  {canRepair ? "Repair session" : "Read-only session"}
                  {session ? ` · ends ${timeAgo(session.expiresAt)}` : ""}
                </CardDescription>
              </div>
              <Button variant="outline" size="sm" onClick={() => void disconnect()} disabled={busy}>
                Disconnect
              </Button>
            </CardHeader>
          </Card>

          {incident ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Activity size={17} aria-hidden="true" className="text-primary" />
                  What the server thinks is wrong
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-foreground">
                  {readIncidentField(incident, "possibleRootCause") ?? "No specific cause identified."}
                </p>
                <p className="text-muted-foreground">
                  {readIncidentField(incident, "suggestedSolution") ?? "No suggested fix."}
                </p>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <MonitorSmartphone size={17} aria-hidden="true" className="text-primary" />
                Devices
              </CardTitle>
              <CardDescription>Pick the device to act on.</CardDescription>
            </CardHeader>
            <CardContent>
              {(data?.devices ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">No devices registered.</p>
              ) : (
                <ul className="divide-y">
                  {(data?.devices ?? []).map((device) => (
                    <li key={device.deviceId} className="flex items-center justify-between gap-3 py-2">
                      <label className="flex min-w-0 items-center gap-2">
                        <input
                          type="radio"
                          name="target-device"
                          checked={targetDevice === device.deviceId}
                          onChange={() => setTargetDevice(device.deviceId)}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-foreground">
                            {device.deviceName ?? device.deviceId}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {device.platform ?? "unknown"} · v{device.appVersion ?? "?"} · seen{" "}
                            {timeAgo(device.lastSeenAt)}
                          </span>
                        </span>
                      </label>
                      <span className="shrink-0 text-xs capitalize text-muted-foreground">{device.status}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {(data?.suggestions ?? []).length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Sparkles size={17} aria-hidden="true" className="text-primary" />
                  Suggested fixes
                </CardTitle>
                <CardDescription>
                  Matched from this shop's live signals.{" "}
                  {data?.autoFix?.enabled
                    ? "Auto-tier fixes run on their own; the rest wait for you."
                    : "This owner has turned automatic fixes off, so all of these wait for you."}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {(data?.suggestions ?? []).map((suggestion) => (
                    <li
                      key={suggestion.playbookId}
                      className="flex flex-wrap items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                          {suggestion.title}
                          <span
                            className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                              suggestion.tier === "auto"
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {suggestion.tier === "auto" ? "automatic" : "needs you"}
                          </span>
                        </p>
                        {/* Evidence, not just a verdict — a fix nobody can explain
                            afterwards is not one worth running on someone's till. */}
                        <p className="mt-0.5 break-words text-xs text-muted-foreground">
                          {Object.entries(suggestion.evidence)
                            .filter(([, value]) => value !== null && value !== undefined)
                            .map(([key, value]) => `${key}: ${String(value)}`)
                            .join(" · ") || "no further detail"}
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy || !canRepair || !targetDevice}
                        onClick={() => void run(suggestion.command)}
                      >
                        Run
                      </Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Wrench size={17} aria-hidden="true" className="text-primary" />
                All fixes
              </CardTitle>
              <CardDescription>
                {canRepair
                  ? "Runs on the selected device the next time it polls — usually within a minute."
                  : "This session is read-only. Ask the owner for a repair session to run fixes."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Why (the owner sees this)"
                maxLength={200}
              />
              <div className="flex flex-wrap gap-2">
                {catalog.map((command) => {
                  const blocked = command.scope === "repair" && !canRepair;
                  return (
                    <Button
                      key={command.type}
                      variant="outline"
                      size="sm"
                      disabled={busy || blocked || !targetDevice}
                      onClick={() => void run(command.type)}
                    >
                      {command.label}
                    </Button>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {settings.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <SlidersHorizontal size={17} aria-hidden="true" className="text-primary" />
                  Settings repair
                </CardTitle>
                <CardDescription>
                  {canRepair
                    ? "Settings the app itself has no screen to fix. This writes the shop's own data — the before value is recorded and the owner can see it."
                    : "Read-only session. A repair session is needed to change a setting."}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {settingNotice ? (
                  <p className="text-sm text-emerald-600 dark:text-emerald-400">{settingNotice}</p>
                ) : null}

                {settings.map((setting) => (
                  <div key={setting.key} className="rounded-lg border p-3">
                    <p className="text-sm font-medium text-foreground">{setting.label}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{setting.description}</p>

                    <p className="mt-2 text-xs">
                      <span className="text-muted-foreground">Currently: </span>
                      <span className={setting.currentValue ? "font-mono text-foreground" : "italic text-destructive"}>
                        {setting.currentValue ?? "not set"}
                      </span>
                      {typeof setting.context?.locationName === "string" ? (
                        <span className="text-muted-foreground"> · {setting.context.locationName}</span>
                      ) : null}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-2">
                      {setting.input === "none" ? null : (
                        <Input
                          value={settingDrafts[setting.key] ?? ""}
                          onChange={(event) =>
                            setSettingDrafts((current) => ({ ...current, [setting.key]: event.target.value }))
                          }
                          placeholder={setting.input === "gstin" ? "15-character GSTIN" : "New value"}
                          className="h-9 max-w-xs font-mono uppercase"
                          maxLength={40}
                        />
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={
                          busy ||
                          !canRepair ||
                          (setting.input !== "none" && !(settingDrafts[setting.key] ?? "").trim())
                        }
                        onClick={() => void applySetting(setting)}
                      >
                        {setting.input === "none" ? "Restore all" : "Apply"}
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">This session's commands</CardTitle>
            </CardHeader>
            <CardContent>
              {(data?.commands ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing run yet.</p>
              ) : (
                <ul className="divide-y">
                  {(data?.commands ?? []).map((command) => (
                    <li key={command.id} className="flex items-start justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-foreground">{command.label}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {command.deviceId} · {timeAgo(command.createdAt)}
                          {command.error ? ` · ${command.error}` : ""}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-medium capitalize text-muted-foreground">
                        {command.status}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </PageShell>
  );
}
