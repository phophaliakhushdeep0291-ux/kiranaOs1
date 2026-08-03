/**
 * App preferences from Settings -> Advanced that other screens have to honour.
 *
 * Kept in localStorage with a sync getter (same shape as landing-page.ts) so
 * the billing keyboard handler, the date formatters and the counter beep can
 * read them without awaiting IndexedDB in the middle of a sale. The synced
 * settings blob stays the source of truth; this is the fast mirror.
 */

const KEY = "kiranaos.appPreferences.v1";

export interface AppPreferences {
  compactMode: boolean;
  shortcuts: boolean;
  sound: boolean;
  /** One of DATE_FORMATS. */
  dateFormat: string;
  /** Cash | UPI | Split — the payment mode Billing opens on. */
  defaultPayment: string;
  /** Prune expired caches and synced history in the background. */
  autoCleanup: boolean;
}

export const DATE_FORMATS = ["DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD"] as const;

export const DEFAULT_APP_PREFERENCES: AppPreferences = {
  compactMode: false,
  shortcuts: true,
  sound: true,
  dateFormat: "DD/MM/YYYY",
  defaultPayment: "Cash",
  autoCleanup: true,
};

let cache: AppPreferences = { ...DEFAULT_APP_PREFERENCES };
let hydrated = false;

/** Storage is absent under SSR/tests and can throw in private mode. */
function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function hydrate(): AppPreferences {
  if (hydrated) return cache;
  hydrated = true;
  try {
    const raw = storage()?.getItem(KEY);
    if (raw) cache = { ...DEFAULT_APP_PREFERENCES, ...(JSON.parse(raw) as Partial<AppPreferences>) };
  } catch {
    /* keep defaults */
  }
  applyDocumentPreferences(cache);
  return cache;
}

export function getAppPreferences(): AppPreferences {
  return hydrate();
}

/**
 * Compact mode is a document-level concern: one attribute on <html> that the
 * stylesheet keys off, so every page tightens at once instead of each screen
 * re-reading a preference.
 */
function applyDocumentPreferences(prefs: AppPreferences) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.density = prefs.compactMode ? "compact" : "comfortable";
}

export function applyAppPreferences(partial: Partial<AppPreferences>): AppPreferences {
  hydrate();
  cache = { ...cache, ...partial };
  try {
    storage()?.setItem(KEY, JSON.stringify(cache));
  } catch {
    /* preference still applies for this session */
  }
  applyDocumentPreferences(cache);
  return cache;
}

export function keyboardShortcutsEnabled(): boolean {
  return hydrate().shortcuts;
}

export function autoCleanupEnabled(): boolean {
  return hydrate().autoCleanup;
}

/**
 * Short confirmation tone after a bill is saved. Uses WebAudio so there is no
 * asset to ship and nothing to fail on a slow counter connection.
 */
export function playCounterBeep(kind: "success" | "error" = "success"): void {
  if (!hydrate().sound) return;
  if (typeof window === "undefined") return;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const context = new Ctor();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = kind === "success" ? 880 : 220;
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.18);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.2);
    oscillator.onended = () => void context.close().catch(() => undefined);
  } catch {
    /* audio blocked until the user interacts — nothing to report */
  }
}

/** Formats a date using the Advanced -> Date format preference. */
export function formatPreferredDate(value: Date | string | number | null | undefined): string {
  if (value == null || value === "") return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = String(date.getFullYear());
  switch (hydrate().dateFormat) {
    case "MM/DD/YYYY": return `${mm}/${dd}/${yyyy}`;
    case "YYYY-MM-DD": return `${yyyy}-${mm}-${dd}`;
    default: return `${dd}/${mm}/${yyyy}`;
  }
}

/** Billing opens on this payment mode. Returns the app's internal mode key. */
export function defaultPaymentMode(): "cash" | "upi" | "split" {
  const label = hydrate().defaultPayment.toLowerCase();
  if (label === "upi") return "upi";
  if (label === "split") return "split";
  return "cash";
}

/**
 * Whether the owner has actually chosen a default payment mode, as opposed to
 * the app falling back to "Cash".
 *
 * `defaultPaymentMode()` cannot answer this: an untouched install and one where
 * the owner deliberately picked Cash both read "cash". §13's learned payment
 * preference needs the difference — a learned suggestion may fill an unset
 * default, but must never quietly override a setting someone chose on purpose.
 */
export function hasExplicitDefaultPayment(): boolean {
  hydrate();
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return false;
    return Object.prototype.hasOwnProperty.call(JSON.parse(raw) as object, "defaultPayment");
  } catch {
    return false;
  }
}
