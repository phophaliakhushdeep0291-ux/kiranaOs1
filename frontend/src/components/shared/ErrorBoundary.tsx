import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCcw } from "lucide-react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message?: string;
  chunkError: boolean;
  /** Bumped on reset so children get a fresh mount — re-rendering the same crashed tree just re-throws. */
  resetKey: number;
}

// A failed lazy-chunk import means this tab's cached index.html points at asset files from an
// older deploy. React caches the rejected import forever, so the ONLY recovery is a full page
// reload (which fetches the new index + chunk hashes) — re-rendering can never fix it.
function isChunkLoadError(message?: string): boolean {
  if (!message) return false;
  return /failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed|loading chunk [\w-]* failed|chunkloaderror|failed to load module script/i.test(message);
}

const AUTO_RELOAD_KEY = "kirana:chunk-auto-reload-at";
const AUTO_RELOAD_COOLDOWN_MS = 60_000;

function tryAutoReload(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(AUTO_RELOAD_KEY) ?? 0);
    if (Date.now() - last < AUTO_RELOAD_COOLDOWN_MS) return false; // avoid reload loops
    window.sessionStorage.setItem(AUTO_RELOAD_KEY, String(Date.now()));
  } catch {
    // sessionStorage blocked — still reload once per page lifetime via the navigation itself.
  }
  window.location.reload();
  return true;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, chunkError: false, resetKey: 0 };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, message: error.message, chunkError: isChunkLoadError(error.message) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App screen crashed", error, info.componentStack);
    // Stale-deploy chunk errors are transient by nature: recover silently with one reload
    // instead of showing the error card for something a refresh always fixes.
    if (isChunkLoadError(error.message)) tryAutoReload();
  }

  reset = () => {
    if (this.state.chunkError) {
      // "Try again" must actually recover: only a reload can fetch the new chunks.
      window.location.reload();
      return;
    }
    this.setState((s) => ({ hasError: false, message: undefined, chunkError: false, resetKey: s.resetKey + 1 }));
  };

  render() {
    if (!this.state.hasError) {
      // Keyed wrapper so reset() remounts the subtree instead of re-rendering the crashed one.
      return <div key={this.state.resetKey} className="contents">{this.props.children}</div>;
    }

    if (this.state.chunkError) {
      // Auto-reload is (or just was) in flight — show a quiet updating state, not an error card.
      return (
        <div className="app-page-shell flex min-h-[70vh] items-center justify-center p-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <RefreshCcw size={22} className="animate-spin text-[#075fff]" aria-hidden="true" />
            <p className="text-sm font-semibold text-muted-foreground">Updating to the latest version…</p>
            <Button variant="outline" size="sm" className="mt-1" onClick={() => window.location.reload()}>
              Reload now
            </Button>
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
