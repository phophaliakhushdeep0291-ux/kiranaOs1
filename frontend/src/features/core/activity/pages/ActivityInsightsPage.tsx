import { useState, type ReactNode } from "react";
import { Activity, BarChart3, Clock, Lightbulb, PackageSearch, ShoppingCart, TrendingDown, Users } from "lucide-react";
import { PageHeader, PageShell, LoadingSkeleton, ErrorState, EmptyState } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useActivityAnalytics, useActivityInsights, usePersonalization, useReportView } from "@/lib/activity";
import type { AbandonedCartEntry, InsightResult } from "@/lib/activity";
import { cn } from "@/lib/utils";

/**
 * Activity & Insights (§13's Business Intelligence + AI Learning Layer).
 *
 * Owner-only, and framed as *evidence* rather than as a verdict. Every block
 * either shows counted behaviour or says plainly that there is not enough of it
 * yet, because a confident-looking ranking built on nine events is worse than an
 * empty panel — the owner would act on it.
 *
 * Nothing here is a financial figure. Money lives in Reports, which reads the
 * bills; this page reads how the software is used.
 */

const WINDOWS = [7, 30, 90] as const;

export default function ActivityInsightsPage() {
  useReportView("activity_insights", "Activity & insights");
  const [days, setDays] = useState<number>(30);
  const analytics = useActivityAnalytics(days);
  const insights = useActivityInsights(days);
  const personalization = usePersonalization();

  if (analytics.isLoading || insights.isLoading) {
    return (
      <PageShell>
        <PageHeader title="Activity & Insights" description="How this shop actually uses Artha." />
        <LoadingSkeleton variant="detail" rows={6} />
      </PageShell>
    );
  }

  if (analytics.isError && insights.isError) {
    return (
      <PageShell>
        <PageHeader title="Activity & Insights" />
        <ErrorState
          title="Couldn't load activity"
          description="Activity data needs a connection. Your bills and stock are unaffected."
          onRetry={() => {
            void analytics.refetch();
            void insights.refetch();
          }}
        />
      </PageShell>
    );
  }

  const data = analytics.data;
  const learned = insights.data;
  const noActivityYet = (data?.totalEvents ?? 0) === 0;

  return (
    <PageShell>
      <PageHeader
        title="Activity & Insights"
        description="Counted from how this shop is used — not a financial report. Figures cover the selected window."
        actions={
          <div className="flex gap-1.5">
            {WINDOWS.map((option) => (
              <Button
                key={option}
                size="sm"
                variant={days === option ? "default" : "outline"}
                onClick={() => setDays(option)}
              >
                {option}d
              </Button>
            ))}
          </div>
        }
      />

      {noActivityYet ? (
        <EmptyState
          icon={<Activity size={22} />}
          title="No activity recorded yet"
          description="Activity starts building as the shop is used — billing, searching, reports and online orders. Come back after a day of trading."
        />
      ) : (
        <div className="space-y-4">
          {/* ── Engagement ─────────────────────────────── */}
          <Section icon={<Users size={16} />} title="Who is using it">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Metric label="Active today" value={data?.activeUsers.dau} />
              <Metric label="Active this week" value={data?.activeUsers.wau} />
              <Metric label="Active this month" value={data?.activeUsers.mau} />
              <Metric
                label="Daily habit"
                value={data?.activeUsers.stickiness === null || data?.activeUsers.stickiness === undefined ? null : `${Math.round(data.activeUsers.stickiness * 100)}%`}
                hint="Share of this month's users who were active today"
              />
            </div>
          </Section>

          {/* ── Speed ──────────────────────────────────── */}
          <Section icon={<Clock size={16} />} title="How long things take">
            <div className="grid gap-3 sm:grid-cols-3">
              <Metric label="Average bill" value={formatDuration(data?.averageBillingTimeMs.averageMs)} hint={sampleHint(data?.averageBillingTimeMs.samples)} />
              <Metric label="Average search" value={formatDuration(data?.averageSearchDurationMs.averageMs)} hint={sampleHint(data?.averageSearchDurationMs.samples)} />
              <Metric label="Average online checkout" value={formatDuration(data?.averageCheckoutDurationMs.averageMs)} hint={sampleHint(data?.averageCheckoutDurationMs.samples)} />
            </div>
            {data && data.slowestTasks.length > 0 && (
              <RankedList
                caption="Tasks by total time spent"
                rows={data.slowestTasks.map((row) => ({ label: row.label, value: `${formatDuration(row.averageMs)} × ${row.samples}` }))}
              />
            )}
          </Section>

          {/* ── Features ───────────────────────────────── */}
          <Section icon={<BarChart3 size={16} />} title="Feature usage">
            <div className="grid gap-4 md:grid-cols-2">
              <RankedList
                caption="Most used"
                rows={(data?.mostUsedFeatures ?? []).map((row) => ({
                  label: row.label,
                  value: `${row.count} × · ${row.adoptionRate === null ? "—" : `${Math.round(row.adoptionRate * 100)}% of staff`}`,
                }))}
                empty="No named features used yet."
              />
              <RankedList
                caption="Least used"
                rows={(data?.leastUsedFeatures ?? []).map((row) => ({ label: row.label, value: `${row.count} ×` }))}
                empty="Not enough variety to rank."
              />
            </div>
          </Section>

          {/* ── What gets touched ──────────────────────── */}
          <Section icon={<PackageSearch size={16} />} title="Products and reports">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <RankedList
                caption="Most searched"
                rows={(data?.mostSearchedProducts ?? []).map((row) => ({ label: row.label ?? row.key, value: `${row.count} ×` }))}
                empty="No searches recorded yet."
              />
              <RankedList
                caption="Most edited products"
                rows={(data?.mostEditedProducts ?? []).map((row) => ({ label: row.label ?? row.key, value: `${row.count} ×` }))}
                empty="No stock edits in this window."
              />
              <RankedList
                caption="Cancelled bills"
                rows={(data?.cancelledBills.reasons ?? []).map((row) => ({ label: row.label ?? row.key, value: `${row.count} ×` }))}
                empty={data?.cancelledBills.total ? "Cancelled without a stated reason." : "No bills cancelled — good."}
              />
            </div>
          </Section>

          {/* ── Online funnel ──────────────────────────── */}
          <Section icon={<ShoppingCart size={16} />} title="Online orders">
            {data && data.online.sessions === 0 ? (
              <p className="text-sm text-muted-foreground">No online sessions in this window. Share your QR ordering link to start seeing this.</p>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <Metric label="Sessions" value={data?.online.sessions} />
                  <Metric label="Orders placed" value={data?.online.checkoutsCompleted} />
                  <Metric label="Conversion" value={percent(data?.online.conversionRate)} hint="Orders ÷ sessions" />
                  <Metric label="Carts abandoned" value={percent(data?.online.cartAbandonmentRate)} hint="Abandoned ÷ (abandoned + ordered)" />
                </div>
                <InsightBlock insight={learned?.checkoutDropOff} title="Where customers stop" />
                <InsightBlock insight={learned?.onlineViewedNotBought} title="Looked at but never added" />
                <AbandonedCarts carts={personalization.data?.abandonedCarts ?? []} />
              </>
            )}
          </Section>

          {/* ── Learned insights ───────────────────────── */}
          <Section icon={<Lightbulb size={16} />} title="What your activity suggests">
            <div className="grid gap-4 md:grid-cols-2">
              <InsightBlock insight={learned?.topProducts} title="You sell these most" />
              <InsightBlock insight={learned?.peakHours} title="Your busiest hours" />
              <InsightBlock insight={learned?.reorder} title="Worth reordering" />
              <InsightBlock insight={learned?.lapsingCustomers} title="Customers visiting less" />
              <InsightBlock insight={learned?.topReports} title="Reports you open most" />
              <InsightBlock insight={learned?.slowestTasks} title="Where your time goes" />
            </div>
          </Section>

          {/* ── Support / errors ───────────────────────── */}
          <Section icon={<TrendingDown size={16} />} title="Problems">
            <div className="grid gap-4 md:grid-cols-2">
              <RankedList
                caption="Screens people report issues from"
                rows={(data?.commonSupportIssues.byPage ?? []).map((row) => ({ label: row.page, value: `${row.count} (${row.open} open)` }))}
                empty="No issues reported."
              />
              <RankedList
                caption="Most frequent errors"
                rows={(data?.commonSystemErrors ?? []).map((row) => ({ label: row.title, value: `${row.count} ×` }))}
                empty="No errors recorded."
              />
            </div>
          </Section>
        </div>
      )}
    </PageShell>
  );
}

/**
 * Abandoned carts (§13).
 *
 * The spec asks for reminders, and this stops short of sending them — honestly,
 * not as an omission. The QR storefront is anonymous: a shopper is identified
 * only at checkout, so a cart abandoned *before* that has no name, phone or
 * email attached to it, and activity telemetry redacts contact details anyway.
 * There is nobody to remind.
 *
 * What the owner can act on is the pattern — how often it happens, how much
 * value walks away, and how big those baskets were. Sending a real reminder
 * needs identity captured earlier in the storefront flow, which is a product
 * decision rather than a wiring gap.
 */
function AbandonedCarts({ carts }: { carts: AbandonedCartEntry[] }) {
  if (carts.length === 0) return null;
  const value = carts.reduce((sum, cart) => sum + (cart.total ?? 0), 0);
  return (
    <div className="min-w-0 rounded-xl border border-border p-3">
      <p className="mb-1.5 text-xs font-bold text-muted-foreground">
        Abandoned baskets ({carts.length}
        {value > 0 ? ` · ₹${Math.round(value).toLocaleString("en-IN")} walked away` : ""})
      </p>
      <ol className="space-y-1">
        {carts.slice(0, 6).map((cart) => (
          <li key={cart.sessionId} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-semibold text-foreground">
              {cart.itemCount ?? cart.productIds.length} item{(cart.itemCount ?? cart.productIds.length) === 1 ? "" : "s"}
              {cart.customerName ? ` · ${cart.customerName}` : ""}
            </span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {cart.total ? `₹${Math.round(cart.total).toLocaleString("en-IN")}` : "—"}
            </span>
          </li>
        ))}
      </ol>
      <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
        Online shoppers stay anonymous until checkout, so these carts carry no contact details to remind.
      </p>
    </div>
  );
}

/* ── presentation helpers ─────────────────────────────────── */

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <h2 className="flex items-center gap-2 text-sm font-black text-foreground">
          <span className="text-muted-foreground">{icon}</span>
          {title}
        </h2>
        {children}
      </CardContent>
    </Card>
  );
}

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-black tabular-nums text-foreground">{value ?? "—"}</p>
      {hint ? <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function RankedList({ caption, rows, empty }: { caption: string; rows: Array<{ label: string; value: string }>; empty?: string }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-xs font-bold text-muted-foreground">{caption}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty ?? "Nothing yet."}</p>
      ) : (
        <ol className="space-y-1">
          {rows.slice(0, 8).map((row, index) => (
            <li key={`${row.label}-${index}`} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-semibold text-foreground">
                <span className="mr-1.5 text-xs text-muted-foreground">{index + 1}.</span>
                {row.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{row.value}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * An insight either shows its ranking or states why it cannot. The
 * "not enough data" case is rendered as plainly as the answer — it is the honest
 * output, not a failure to hide.
 */
function InsightBlock({ insight, title }: { insight?: InsightResult; title: string }) {
  if (!insight) return null;
  return (
    <div className={cn("min-w-0 rounded-xl border border-border p-3", !insight.sufficientData && "bg-muted/20")}>
      <p className="mb-1.5 text-xs font-bold text-muted-foreground">{title}</p>
      {!insight.sufficientData ? (
        <p className="text-sm text-muted-foreground">{insight.note ?? "Not enough history yet."}</p>
      ) : (
        <ol className="space-y-1">
          {insight.items.slice(0, 6).map((item, index) => (
            <li key={index} className="flex min-w-0 items-baseline justify-between gap-3 text-sm">
              <span className="truncate font-semibold text-foreground">
                <span className="mr-1.5 text-xs text-muted-foreground">{index + 1}.</span>
                {describeInsightItem(item)}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{quantifyInsightItem(item)}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/**
 * Insight rows have different shapes per insight; these two read whichever
 * fields are present rather than requiring one row type per insight.
 */
function describeInsightItem(item: Record<string, unknown>): string {
  for (const key of ["name", "productName", "label", "report", "task"]) {
    const value = item[key];
    if (typeof value === "string" && value) return value;
  }
  return "—";
}

function quantifyInsightItem(item: Record<string, unknown>): string {
  if (typeof item.timesBilled === "number") return `${item.timesBilled} ×`;
  if (typeof item.opened === "number") return `${item.opened} ×`;
  if (typeof item.bills === "number") return `${item.bills} bills`;
  if (typeof item.recommendedOrderBaseQty === "number") return `order ${item.recommendedOrderBaseQty} ${String(item.baseUnit ?? "")}`.trim();
  if (typeof item.dropPercent === "number") return `down ${item.dropPercent}%`;
  if (typeof item.views === "number") return `${item.views} views · ${item.cartAdds ?? 0} added`;
  if (typeof item.averageMs === "number") return formatDuration(item.averageMs);
  if (typeof item.count === "number") return `${item.count}`;
  return "";
}

function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${Math.round(ms / 100) / 10}s`;
  return `${Math.round(ms / 6000) / 10} min`;
}

function sampleHint(samples: number | undefined): string | undefined {
  if (!samples) return "No timed samples yet";
  return `${samples} sample${samples === 1 ? "" : "s"}`;
}

function percent(rate: number | null | undefined): string {
  // A null rate means an empty denominator. "—" is honest; "0%" would read as a
  // problem the shop does not have.
  if (rate === null || rate === undefined) return "—";
  return `${Math.round(rate * 100)}%`;
}
