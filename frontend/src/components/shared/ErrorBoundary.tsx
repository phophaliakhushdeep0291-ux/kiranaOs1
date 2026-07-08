import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCcw } from "lucide-react";
import { recoverFromStaleDeploy } from "@/lib/pwa/registerServiceWorker";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message?: string;
  chunkError: boolean;
  /** True only while the one-shot auto-recovery reload is in flight. */
  recovering: boolean;
  /** Bumped on reset so children get a fresh mount; re-rendering the crashed tree just re-throws. */
  resetKey: number;
}

// A failed lazy-chunk import means this tab's cached index.html points at asset files from an
// older deploy. React caches the rejected import forever, so the only recovery is a full reload
// that fetches the new build; on a PWA that reload must bust the service-worker cache first.
function isChunkLoadError(message?: string): boolean {
  if (!message) return false;
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [\w-]* failed|chunkloaderror|failed to load module script/i.test(message);
}

// Recover at most once per window, so a chunk that genuinely 404s (or an offline shop) can never
// spin in a reload loop; the second failure shows a real button instead.
const STALE_RECOVERY_KEY = "kirana:stale-deploy-recovered-at";
const STALE_RECOVERY_COOLDOWN_MS = 30_000;
const RECOVERY_SPINNER_TIMEOUT_MS = 8_000;

function recentlyAttemptedRecovery(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(STALE_RECOVERY_KEY) ?? 0);
    return Number.isFinite(last) && Date.now() - last < STALE_RECOVERY_COOLDOWN_MS;
  } catch {
    return false;
  }
}

function markRecoveryAttempt(): void {
  try {
    window.sessionStorage.setItem(STALE_RECOVERY_KEY, String(Date.now()));
  } catch {
    // sessionStorage blocked; recovery still runs, just without the loop guard.
  }
}

function clearRecoveryAttempt(): void {
  try {
    window.sessionStorage.removeItem(STALE_RECOVERY_KEY);
  } catch {
    // Storage can be blocked; the recovery helper can still try.
  }
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, chunkError: false, recovering: false, resetKey: 0 };
  private recoveryTimer: number | undefined;

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, message: error.message, chunkError: isChunkLoadError(error.message) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App screen crashed", error, info.componentStack);
    if (isChunkLoadError(error.message)) this.startChunkRecovery();
  }

  componentWillUnmount(): void {
    if (this.recoveryTimer) window.clearTimeout(this.recoveryTimer);
  }

  private startChunkRecovery = () => {
    if (this.recoveryTimer) window.clearTimeout(this.recoveryTimer);

    // Stale-deploy chunk errors are transient: recover silently once by busting the PWA cache and
    // reloading. If it still fails, show a card with a manual retry so the user is never stuck.
    if (recentlyAttemptedRecovery()) {
      this.setState({ recovering: false });
      return;
    }

    markRecoveryAttempt();
    this.setState({ recovering: true });
    this.recoveryTimer = window.setTimeout(() => {
      this.setState((state) => (state.recovering ? { recovering: false } : null));
    }, RECOVERY_SPINNER_TIMEOUT_MS);

    void recoverFromStaleDeploy().catch(() => {
      if (this.recoveryTimer) window.clearTimeout(this.recoveryTimer);
      this.setState({ recovering: false });
    });
  };

  private retryChunkRecovery = () => {
    clearRecoveryAttempt();
    this.startChunkRecovery();
  };

  reset = () => {
    if (this.state.chunkError) {
      this.retryChunkRecovery();
      return;
    }
    this.setState((s) => ({ hasError: false, message: undefined, chunkError: false, recovering: false, resetKey: s.resetKey + 1 }));
  };

  render() {
    if (!this.state.hasError) {
      return <div key={this.state.resetKey} className="contents">{this.props.children}</div>;
    }

    if (this.state.chunkError) {
      if (this.state.recovering) {
        return (
          <div className="app-page-shell flex min-h-[70vh] items-center justify-center p-4">
            <div className="flex flex-col items-center gap-3 text-center">
              <RefreshCcw size={22} className="animate-spin text-[#075fff]" aria-hidden="true" />
              <p className="text-sm font-semibold text-muted-foreground">Updating to the latest version...</p>
              <Button variant="outline" size="sm" className="mt-1" onClick={this.retryChunkRecovery}>
                Taking too long? Reload now
              </Button>
            </div>
          </div>
        );
      }

      return (
        <div className="app-page-shell flex min-h-[70vh] items-center justify-center p-4">
          <div className="w-full max-w-md rounded-lg border bg-card p-6 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
              <RefreshCcw size={22} aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold">Could not finish updating</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              A new version is available but this screen did not refresh. Reload the app to update. Your shop data is safe.
            </p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <Button onClick={this.retryChunkRecovery} className="min-h-11">
                <RefreshCcw size={16} aria-hidden="true" />
                Reload app
              </Button>
              <Button variant="outline" onClick={() => window.location.assign("/dashboard")} className="min-h-11">
                Go to dashboard
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="app-page-shell flex min-h-[70vh] items-center justify-center p-4">
        <div className="w-full max-w-lg rounded-lg border bg-card p-6 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle size={24} aria-hidden="true" />
          </div>
          <h1 className="text-xl font-bold">{this.props.fallbackTitle ?? "Screen could not load"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your local data is still safe. Try opening this screen again. If it repeats, share the details with support.
          </p>
          {this.state.message && (
            <details className="mt-4 rounded-lg border bg-muted/40 p-3 text-left text-xs text-muted-foreground">
              <summary className="cursor-pointer font-medium text-foreground">Technical details</summary>
              <pre className="mt-2 whitespace-pre-wrap break-words">{this.state.message}</pre>
            </details>
          )}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
            <Button onClick={this.reset} className="min-h-11">
              <RefreshCcw size={16} aria-hidden="true" />
              Try again
            </Button>
            <Button variant="outline" onClick={() => window.location.assign("/dashboard")} className="min-h-11">
              Go to dashboard
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
