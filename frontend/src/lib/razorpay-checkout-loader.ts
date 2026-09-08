const CHECKOUT_URL = "https://checkout.razorpay.com/v1/checkout.js";
const LOAD_TIMEOUT_MS = 15_000;
let loading: Promise<void> | null = null;

/** Shared by retail and subscription checkout; failed downloads are retryable. */
export function loadRazorpayCheckout(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Checkout is available only in the browser."));
  }
  const ready = () => typeof (window as Window & { Razorpay?: unknown }).Razorpay === "function";
  if (ready()) return Promise.resolve();
  if (loading) return loading;
  const attempt = new Promise<void>((resolve, reject) => {
    let script = document.querySelector<HTMLScriptElement>("script[data-razorpay-checkout]");
    if (script && (script.src !== CHECKOUT_URL || script.dataset.razorpayState === "failed" || script.dataset.razorpayState === "loaded")) {
      script.remove(); script = null;
    }
    const created = !script;
    const element = script ?? document.createElement("script");
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      element.removeEventListener("load", onLoad);
      element.removeEventListener("error", onError);
    };
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true; cleanup();
      element.dataset.razorpayState = error ? "failed" : "loaded";
      if (error) { element.remove(); reject(error); }
      else resolve();
    };
    const onLoad = () => finish(ready() ? undefined : new Error("Payment checkout did not initialize. Please retry."));
    const onError = () => finish(new Error("Unable to load payment checkout. Check your connection and retry."));
    const timer = setTimeout(() => finish(new Error("Payment checkout took too long to load. Check your connection and retry.")), LOAD_TIMEOUT_MS);
    element.addEventListener("load", onLoad);
    element.addEventListener("error", onError);
    if (created) {
      element.src = CHECKOUT_URL;
      element.async = true;
      element.dataset.razorpayCheckout = "true";
      element.dataset.razorpayState = "loading";
      try { document.head.appendChild(element); }
      catch { onError(); }
    }
  });
  loading = attempt;
  // Reset on success as well: if the provider global is later absent, a fresh
  // load is required rather than a cached promise that falsely says ready.
  void attempt.then(() => { if (loading === attempt) loading = null; }, () => { if (loading === attempt) loading = null; });
  return attempt;
}
