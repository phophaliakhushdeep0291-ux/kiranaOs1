import { Link } from "wouter";
import { AlertTriangle, ChevronRight, Clock, CloudOff, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscriptionSnapshot } from "@/features/core/subscription/access";
import { useAppLanguage } from "@/features/core/settings/i18n";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_WARN_DAYS = 3;

function trialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const msLeft = new Date(trialEndsAt).getTime() - Date.now();
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / DAY_MS);
}

export function SubscriptionStatusBanner() {
  const { t } = useAppLanguage();
  const { snapshot, loading } = useSubscriptionSnapshot();
  if (loading || !snapshot) return null;

  const daysLeft = snapshot.isTrial ? trialDaysLeft(snapshot.trialEndsAt) : null;
  if (snapshot.foundingCustomer && snapshot.foundingEndsAt && daysLeft !== null) {
    return (
      <div className="border-b bg-emerald-50 px-4 py-2 text-emerald-900">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2"><Clock size={16} /><span><strong>Founding customer:</strong> {daysLeft} day{daysLeft === 1 ? "" : "s"} free remaining. Then renew on {snapshot.plan.name}; your data and billing stay available.</span></div>
          <Link href="/subscription"><Button size="sm" variant="outline">View end date</Button></Link>
        </div>
      </div>
    );
  }
  const showTrialWarning = snapshot.isTrial && snapshot.status === "trial" && daysLeft !== null && daysLeft <= TRIAL_WARN_DAYS;

  if (snapshot.status === "active" && snapshot.cloudSyncAllowed && !showTrialWarning) return null;

  if (showTrialWarning && snapshot.status === "trial" && snapshot.cloudSyncAllowed) {
    const label = daysLeft === 0 ? "Trial ends today" : daysLeft === 1 ? "1 day left in trial" : `${daysLeft} days left in trial`;
    return (
      <div className="border-b bg-amber-50 px-4 py-2 text-amber-800">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <Clock size={16} />
            <span>{label} — upgrade to keep your data synced across devices.</span>
          </div>
          <Link href="/plans"><Button size="sm" variant="outline">See plans</Button></Link>
        </div>
      </div>
    );
  }

  const isDanger = snapshot.isExpired || snapshot.isPaymentFailed;
  const Icon = snapshot.cloudSyncAllowed ? ShieldCheck : snapshot.isPaymentFailed ? CreditCard : CloudOff;
  const plainMessage = snapshot.graceActive
    ? "Billing is available. New bills stay safe on this device and cloud backup will resume after renewal."
    : snapshot.localOnlyAfterExpiry
      ? "Your saved records are available on this device. Renew to resume cloud backup."
      : snapshot.message;
  /**
   * The same standing not-quite-a-problem, told in a phone's worth of words.
   *
   * These sentences are written for a desktop strip that can hold one line of
   * them. On a 375px screen the full text needs three, and a permanent
   * three-line band above every screen costs more than it explains — so the
   * phone gets the headline and "Owner details" carries the rest.
   */
  const shortMessage = snapshot.isPaymentFailed
    ? t("chrome.subscription.paymentFailedShort")
    : snapshot.isExpired
      ? t("chrome.subscription.expiredShort")
      : snapshot.graceActive
        ? t("chrome.subscription.graceShort")
        : snapshot.isTrial
          ? t("chrome.subscription.trialShort")
          : t("chrome.subscription.activeShort");
  return (
    <div className={`border-b px-3 py-1.5 sm:px-4 ${isDanger ? "bg-amber-50 text-amber-950" : "bg-amber-50 text-amber-800"}`}>
      <div className="flex min-h-11 items-center gap-2 text-xs sm:text-sm">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="shrink-0">{snapshot.graceActive ? <AlertTriangle size={16} /> : <Icon size={16} />}</span>
          {/* A single `truncate` clipped the long form to 210px of the 460px it
              needs, so a phone read "Trial active. Your data is safe locall…" and
              learned nothing at all. Each width now gets a sentence it can finish. */}
          <span className="min-w-0 flex-1 leading-snug sm:hidden">{shortMessage}</span>
          <span className="hidden min-w-0 flex-1 sm:inline">{plainMessage}</span>
        </div>
        <Link href="/subscription" className="inline-flex min-h-11 shrink-0 items-center gap-1 rounded-lg px-2 font-black text-current hover:bg-black/5">
          <span className="hidden sm:inline">{t("chrome.subscription.ownerDetails")}</span>
          <span className="sm:hidden">{t("chrome.subscription.details")}</span>
          <ChevronRight size={14} aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
