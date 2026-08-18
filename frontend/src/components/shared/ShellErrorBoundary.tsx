import { Component, type ErrorInfo, type ReactNode } from "react";
import { isChunkLoadError } from "@/components/shared/ErrorBoundary";
import { recoverFromStaleDeploy } from "@/lib/pwa/registerServiceWorker";
import { reportClientError } from "@/lib/diagnostics";
import { getInitialLanguage, type AppLanguage } from "@/features/core/settings/i18n";

/**
 * The last screen a shop can be shown.
 *
 * `ErrorBoundary` guards a page: it says "this screen could not load" and offers
 * the dashboard, which only makes sense while the shell around it still works.
 * This one guards the shell itself — the providers, the auth bootstrap, the sync
 * bridge, the toaster. When something there throws, React unmounts the ROOT and
 * a counter is left staring at white, which is exactly what happened when a
 * translated toast was mounted outside its language provider.
 *
 * Everything here is deliberately dependency-minimal. No context, no query
 * client, no `t()`, no UI kit — a fallback that reads from a provider is
 * worthless precisely when the provider is what broke. The copy is bilingual and
 * inline, and the language is read straight off localStorage.
 */

interface ShellCopy {
  heading: string;
  body: string;
  action: string;
  details: string;
}

/** Exported for test: the crash screen must speak the shop's language. */
export function shellCrashCopy(language: AppLanguage): ShellCopy {
  if (language === "hi") {
    return {
      heading: "ऐप खुल नहीं सका",
      // The first thing a shopkeeper needs to know is that nothing was lost.
      body: "आपके बिल, स्टॉक और उधार इसी डिवाइस पर सुरक्षित हैं। कुछ भी मिटा नहीं है। दोबारा शुरू करने के लिए नीचे दबाएं।",
      action: "ऐप दोबारा खोलें",
      details: "तकनीकी जानकारी",
    };
  }
  return {
    heading: "The app could not open",
    body: "Your bills, stock and udhar are saved on this device and nothing has been lost. Reopen the app to carry on.",
    action: "Reopen app",
    details: "Technical details",
  };
}

interface ShellErrorBoundaryProps {
  children: ReactNode;
}

interface ShellErrorBoundaryState {
  hasError: boolean;
  message?: string;
}

export class ShellErrorBoundary extends Component<ShellErrorBoundaryProps, ShellErrorBoundaryState> {
  state: ShellErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ShellErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App shell crashed", error, info.componentStack);
    // A stale-deploy chunk failure is transient and self-healing; everything else
    // is a real defect and worth a report, because at this level it took the
    // whole till down rather than one screen.
    if (isChunkLoadError(error.message)) {
      void recoverFromStaleDeploy().catch(() => undefined);
      return;
    }
    reportClientError({ source: "react-shell-boundary", message: error.message, stack: error.stack });
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    // `getInitialLanguage` reads localStorage and touches no React context, so it
    // is safe here in a way `useAppLanguage` deliberately is not.
    let copy: ShellCopy;
    try {
      copy = shellCrashCopy(getInitialLanguage());
    } catch {
      copy = shellCrashCopy("en");
    }

    return (
      <div
        role="alert"
        style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          padding: "24px",
          // Inline styles on purpose: a stylesheet that failed to load is one of
          // the ways this screen gets reached, and an unstyled white page with
          // white text is the same as no page at all.
          background: "#f7f9fc",
          color: "#0f172a",
          fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        }}
      >
        <div style={{ maxWidth: "420px", width: "100%", textAlign: "center" }}>
          <h1 style={{ fontSize: "20px", fontWeight: 800, margin: "0 0 10px" }}>{copy.heading}</h1>
          <p style={{ fontSize: "14px", lineHeight: 1.6, margin: "0 0 20px", color: "#475569" }}>{copy.body}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              // 44px, because this is tapped on a phone at a counter.
              minHeight: "44px",
              padding: "0 22px",
              borderRadius: "10px",
              border: "none",
              // Themed when the stylesheet is present, so the shop's accent still
              // applies here; the fallback is a neutral dark rather than a brand
              // hex, both because a literal brand colour would ignore that accent
              // and because this button has to stay visible if the stylesheet is
              // the thing that failed to load.
              background: "var(--brand, #1f2937)",
              color: "#fff",
              fontSize: "14px",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            {copy.action}
          </button>
          {this.state.message ? (
            <details style={{ marginTop: "22px", textAlign: "left" }}>
              <summary style={{ cursor: "pointer", fontSize: "12px", color: "#64748b" }}>{copy.details}</summary>
              <pre
                style={{
                  marginTop: "8px",
                  padding: "10px",
                  borderRadius: "8px",
                  background: "#eef2f7",
                  fontSize: "11px",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: "#475569",
                }}
              >
                {this.state.message}
              </pre>
            </details>
          ) : null}
        </div>
      </div>
    );
  }
}
