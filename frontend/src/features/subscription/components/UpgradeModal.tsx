import { useEffect, useState } from "react";
import { CheckCircle2, CreditCard, ShieldCheck, Tag, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PLAN_DEFINITIONS, type BillingCycle, type PlanCode } from "@/features/subscription/plans";
import { subscriptionRefreshLocalFirst } from "@/features/subscription/local-actions";
import {
  writeSubscriptionRequest,
  writeSubscriptionSnapshot,
} from "@/features/subscription/access";
import {
  requestSubscriptionUpgrade,
  validateSubscriptionCoupon,
  verifySubscriptionPayment,
  type CouponValidationDto,
  type SubscriptionCheckoutDto,
} from "@/features/subscription/api";
import { ApiClientError } from "@/lib/api/http";
import { useToast } from "@/hooks/use-toast";

interface RazorpaySuccessResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  handler: (response: RazorpaySuccessResponse) => void;
  modal?: { ondismiss?: () => void };
  theme?: { color?: string };
}

type RazorpayInstance = {
  open: () => void;
  on: (
    eventName: "payment.failed",
    handler: (response: {
      error?: { description?: string; reason?: string };
    }) => void,
  ) => void;
};

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => RazorpayInstance;
  }
}

let razorpayLoader: Promise<void> | null = null;

function loadRazorpayCheckout() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Checkout is available only in the browser."));
  }
  if (window.Razorpay) return Promise.resolve();
  if (razorpayLoader) return razorpayLoader;

  razorpayLoader = new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-razorpay-checkout]",
    );
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Unable to load payment checkout.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.dataset.razorpayCheckout = "true";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Unable to load payment checkout."));
    document.head.appendChild(script);
  });

  return razorpayLoader;
}

async function openRazorpayCheckout(
  checkout: SubscriptionCheckoutDto,
  planName: string,
) {
  await loadRazorpayCheckout();
  return new Promise<RazorpaySuccessResponse>((resolve, reject) => {
    const Razorpay = window.Razorpay;
    if (!Razorpay) {
      reject(new Error("Payment checkout did not load."));
      return;
    }

    let completed = false;
    const instance = new Razorpay({
      key: checkout.razorpayKeyId,
      amount: checkout.amountPaise,
      currency: checkout.currency,
      name: "Kirana OS",
      description: `${planName} subscription`,
      order_id: checkout.orderId,
      handler: (response) => {
        completed = true;
        resolve(response);
      },
      modal: {
        ondismiss: () => {
          if (!completed) reject(new Error("Payment cancelled."));
        },
      },
      theme: { color: "#0f766e" },
    });

    instance.on("payment.failed", (response) => {
      completed = true;
      reject(
        new Error(
          response.error?.description ??
            response.error?.reason ??
            "Payment failed.",
        ),
      );
    });
    instance.open();
  });
}

function shouldSaveOfflineRequest(error: unknown) {
  if (error instanceof Error && error.message.toLowerCase().includes("cancelled")) {
    return false;
  }
  if (error instanceof ApiClientError && error.data.code?.startsWith("COUPON_")) return false;
  return true;
}

function checkoutErrorMessage(error: unknown) {
  if (error instanceof ApiClientError) {
    return error.data.code === "RAZORPAY_NOT_CONFIGURED"
      ? "Online payment is not configured yet. The request was saved for owner follow-up."
      : error.message;
  }
  return error instanceof Error ? error.message : "Unable to start online checkout.";
}

export function UpgradeModal({
  open,
  onOpenChange,
  targetPlanCode,
  reason,
  billingCycle = "yearly",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetPlanCode?: PlanCode;
  reason?: string;
  billingCycle?: BillingCycle;
}) {
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [validatingCoupon, setValidatingCoupon] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCoupon, setAppliedCoupon] = useState<CouponValidationDto | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const target = PLAN_DEFINITIONS[targetPlanCode ?? "growth"];

  useEffect(() => {
    setCouponCode("");
    setAppliedCoupon(null);
    setCouponError(null);
  }, [open, target.code, billingCycle]);

  async function applyCoupon() {
    const code = couponCode.trim().toUpperCase();
    if (!code) {
      setCouponError("Enter a coupon code first.");
      return;
    }
    setValidatingCoupon(true);
    setCouponError(null);
    try {
      const result = await validateSubscriptionCoupon({ planCode: target.code, billingCycle, couponCode: code });
      setCouponCode(result.couponCode);
      setAppliedCoupon(result);
    } catch (error) {
      setAppliedCoupon(null);
      setCouponError(error instanceof Error ? error.message : "Unable to validate this coupon.");
    } finally {
      setValidatingCoupon(false);
    }
  }

  function removeCoupon() {
    setCouponCode("");
    setAppliedCoupon(null);
    setCouponError(null);
  }

  async function requestUpgrade() {
    setSaving(true);
    try {
      const checkout = await requestSubscriptionUpgrade({
        planCode: target.code,
        billingCycle,
        ...(appliedCoupon ? { couponCode: appliedCoupon.couponCode } : {}),
      });
      const payment = await openRazorpayCheckout(checkout, target.name);
      const result = await verifySubscriptionPayment({
        ...payment,
        transactionId: checkout.transactionId,
      });
      if (result.subscription) {
        await writeSubscriptionSnapshot(
          result.subscription as unknown as Record<string, unknown>,
        );
      }
      await subscriptionRefreshLocalFirst(target.code);
      toast({
        title: "Subscription upgraded",
        description: `${target.name} is active after verified payment.`,
      });
      onOpenChange(false);
    } catch (error) {
      if (error instanceof ApiClientError && error.data.code?.startsWith("COUPON_")) {
        toast({ title: "Coupon not applied", description: error.message });
        return;
      }
      if (!shouldSaveOfflineRequest(error)) {
        toast({
          title: "Payment cancelled",
          description: "Your current plan remains unchanged.",
        });
        return;
      }

      await writeSubscriptionRequest(target.code);
      await subscriptionRefreshLocalFirst(target.code);
      toast({
        title: "Upgrade request saved",
        description: checkoutErrorMessage(error),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Upgrade to {target.name}</DialogTitle>
          <DialogDescription>
            {reason ?? `${target.name} includes this feature.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold">
                {billingCycle === "yearly" ? `Rs ${target.annualPrice}/year` : `Rs ${target.price}/month`}
              </p>
              <p className="text-sm text-muted-foreground">{target.headline}</p>
            </div>
            <Badge variant="secondary">
              {target.maxDevices} device{target.maxDevices > 1 ? "s" : ""}
            </Badge>
          </div>
          <ul className="space-y-1 text-sm text-muted-foreground">
            {target.bullets.slice(0, 4).map((bullet) => (
              <li key={bullet}>- {bullet}</li>
            ))}
          </ul>
          <div className="space-y-1.5 border-t pt-3">
            <label htmlFor="subscription-coupon" className="text-sm font-medium">Coupon code</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Tag className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  id="subscription-coupon"
                  value={couponCode}
                  onChange={(event) => {
                    setCouponCode(event.target.value.toUpperCase());
                    setAppliedCoupon(null);
                    setCouponError(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void applyCoupon();
                    }
                  }}
                  placeholder="Enter coupon code"
                  className="pl-9"
                  maxLength={32}
                  autoComplete="off"
                  disabled={saving || appliedCoupon !== null}
                  aria-invalid={couponError ? true : undefined}
                />
              </div>
              {appliedCoupon ? (
                <Button type="button" variant="outline" size="icon" onClick={removeCoupon} disabled={saving} aria-label="Remove coupon"><X className="h-4 w-4" /></Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => void applyCoupon()} disabled={saving || validatingCoupon || !couponCode.trim()}>
                  {validatingCoupon ? "Checking..." : "Apply"}
                </Button>
              )}
            </div>
            {couponError && <p className="text-xs font-medium text-destructive" role="alert">{couponError}</p>}
            {appliedCoupon ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                <p className="flex items-center gap-1.5 font-semibold"><CheckCircle2 className="h-4 w-4" />Coupon {appliedCoupon.couponCode} applied</p>
                <div className="mt-2 flex items-end justify-between gap-3">
                  <div><span className="text-xs">You save</span><p className="font-semibold">Rs {(appliedCoupon.discountPaise / 100).toLocaleString("en-IN")}</p></div>
                  <div className="text-right"><span className="text-xs line-through">Rs {(appliedCoupon.baseAmountPaise / 100).toLocaleString("en-IN")}</span><p className="text-lg font-bold">Rs {(appliedCoupon.finalAmountPaise / 100).toLocaleString("en-IN")}</p></div>
                </div>
              </div>
            ) : <p className="text-xs text-muted-foreground">The discount is verified securely before payment.</p>}
          </div>
        </div>

        <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <CreditCard className="h-4 w-4 text-primary" />
            <span>Verified payment checkout</span>
          </div>
          <div className="flex items-center gap-2 rounded-md border px-3 py-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <span>Access changes after confirmation</span>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Later
          </Button>
          <Button onClick={() => void requestUpgrade()} disabled={saving || validatingCoupon}>
            {saving ? "Starting..." : appliedCoupon ? `Pay Rs ${(appliedCoupon.finalAmountPaise / 100).toLocaleString("en-IN")}` : "Pay and upgrade"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
