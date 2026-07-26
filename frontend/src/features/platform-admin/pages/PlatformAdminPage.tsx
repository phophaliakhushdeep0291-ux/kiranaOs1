import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, Cpu, Database, LifeBuoy, ShieldAlert, ShieldX, Store } from "lucide-react";
import { LoadingSkeleton, PageHeader, PageShell, StatCard, StatsGrid } from "@/components/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/http";
import { getPlatformOverview, type PlatformOverview } from "@/features/platform-admin/api";

function timeAgo(value?: string | null) {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatDistanceToNow(date, { addSuffix: true }) : "unknown";
}

function shortShop(id?: string | null) {
  return id ? id.slice(0, 8) : "—";
}

interface Row {
  key: string;
  left: string;
  right: string;
  sub?: string;
}

function ListCard({ title, description, empty, rows }: { title: string; description: string; empty: string; rows: Row[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="divide-y">
            {rows.map((row) => (
              <li key={row.key} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{row.left}</p>
                  {row.sub ? <p className="mt-0.5 truncate text-xs text-muted-foreground">{row.sub}</p> : null}
                </div>
                <span className="shrink-0 font-mono text-sm font-semibold text-foreground">{row.right}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function InfraRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">{value}</span>
    </div>
  );
}

function DeniedCard() {
  return (
    <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-lg border bg-card p-8 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <ShieldX className="h-6 w-6" aria-hidden="true" />
      </div>
      <h1 className="text-lg font-bold">Platform admin only</h1>
      <p className="text-sm text-muted-foreground">
        This internal dashboard is limited to platform administrators. Your account does not have access.
      </p>
    </div>
  );
}

export default function PlatformAdminPage() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [state, setState] = useState<"loading" | "ok" | "denied" | "error">("loading");

  useEffect(() => {
    let alive = true;
    getPlatformOverview()
      .then((result) => {
        if (!alive) return;
        setData(result);
        setState("ok");
      })
      .catch((error) => {
        if (!alive) return;
        setState(error instanceof ApiClientError && error.status === 403 ? "denied" : "error");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (state === "loading") {
    return (
      <PageShell>
        <LoadingSkeleton variant="list" rows={4} />
      </PageShell>
    );
  }
  if (state === "denied") {
    return (
      <PageShell>
        <DeniedCard />
      </PageShell>
    );
  }
  if (state === "error" || !data) {
    return (
      <PageShell>
        <p className="text-sm text-muted-foreground">Could not load the admin dashboard right now. Try again in a moment.</p>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader title="Platform admin" description={`Fleet health across all shops · updated ${timeAgo(data.generatedAt)}`} />

      <StatsGrid>
        <StatCard label="Shops" value={data.shops.total} description={`${data.shops.online} online · ${data.shops.offline} offline`} icon={<Store className="h-5 w-5" />} tone="blue" />
        <StatCard label="Devices" value={data.devices.total} description={`${data.devices.active} active`} icon={<Cpu className="h-5 w-5" />} />
        <StatCard label="Crashes (24h)" value={data.incidents.recentCrashes24h} description="Errors captured across the fleet" icon={<AlertTriangle className="h-5 w-5" />} tone={data.incidents.recentCrashes24h ? "red" : "green"} />
        <StatCard label="Sync failures" value={data.incidents.failedSyncEvents} description={`${data.incidents.openConflicts} open conflicts`} icon={<Database className="h-5 w-5" />} tone={data.incidents.failedSyncEvents ? "amber" : "green"} />
        <StatCard label="Support requests" value={data.incidents.openSupportRequests} description="Open, awaiting triage" icon={<LifeBuoy className="h-5 w-5" />} tone={data.incidents.openSupportRequests ? "amber" : "green"} />
      </StatsGrid>

      <div className="grid gap-4 lg:grid-cols-2">
        <ListCard
          title="Most common errors"
          description="Grouped across all shops"
          empty="No errors recorded."
          rows={data.topErrors.map((error) => ({ key: error.id, left: error.title, right: `×${error.count}`, sub: `${error.source} · shop ${shortShop(error.shopId)} · ${timeAgo(error.lastSeenAt)}` }))}
        />
        <ListCard
          title="Failed API endpoints"
          description="Most 5xx-producing endpoints (7 days)"
          empty="No failing endpoints."
          rows={data.failedEndpoints.map((row, index) => ({ key: `${row.endpoint}-${index}`, left: row.endpoint, right: `×${row.count}` }))}
        />
        <ListCard
          title="Recent support requests"
          description="Latest across the fleet"
          empty="No support requests."
          rows={data.recentSupportRequests.map((request) => ({ key: request.id, left: request.description, right: request.status, sub: `${request.page ?? ""} · shop ${shortShop(request.shopId)} · ${timeAgo(request.createdAt)}` }))}
        />
        <ListCard
          title="At-risk stores"
          description="Lowest device health (24h)"
          empty="All monitored devices are healthy."
          rows={data.worstHealthStores.map((store) => ({ key: store.shopId, left: `Shop ${shortShop(store.shopId)}`, right: `${store.minHealthScore}/100` }))}
        />
        <ListCard
          title="App versions"
          description="Devices by build"
          empty="No devices."
          rows={data.appVersions.map((version, index) => ({ key: `${version.appVersion}-${index}`, left: version.appVersion, right: `×${version.count}` }))}
        />
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Infrastructure</CardTitle>
            <CardDescription>Background jobs and cache</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <InfraRow label="Background queue" value={data.queue.enabled ? "Enabled" : "Disabled (inline)"} />
            <InfraRow label="Redis" value={data.queue.redis?.connected ? "Connected" : "Not connected"} />
          </CardContent>
        </Card>
      </div>
    </PageShell>
  );
}
