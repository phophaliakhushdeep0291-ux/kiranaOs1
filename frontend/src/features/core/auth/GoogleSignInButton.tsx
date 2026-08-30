import { useEffect, useRef, useState } from "react";

// "Continue with Google" via Google Identity Services. Renders Google's own button
// (their branding rules require it) and hands the signed ID-token credential to the
// caller — the backend does all verification. Renders nothing when
// VITE_GOOGLE_CLIENT_ID is not configured, so the app works with or without it.

const GIS_SRC = "https://accounts.google.com/gsi/client";
const CLIENT_ID = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined)?.trim();

interface GisIdApi {
  initialize: (config: { client_id: string; callback: (response: { credential?: string }) => void }) => void;
  renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    google?: { accounts?: { id?: GisIdApi } };
  }
}

let gisLoader: Promise<GisIdApi> | null = null;

function loadGis(): Promise<GisIdApi> {
  gisLoader ??= new Promise<GisIdApi>((resolve, reject) => {
    const ready = () => {
      const api = window.google?.accounts?.id;
      if (api) resolve(api);
      else reject(new Error("Google Identity Services unavailable"));
    };
    if (window.google?.accounts?.id) return ready();
    const script = document.createElement("script");
    script.src = GIS_SRC;
    script.async = true;
    script.defer = true;
    script.onload = ready;
    script.onerror = () => {
      gisLoader = null; // allow a retry on the next mount (e.g. offline -> online)
      reject(new Error("Could not load Google sign-in"));
    };
    document.head.appendChild(script);
  });
  return gisLoader;
}

export function isGoogleSignInConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

/**
 * Google renders its button inside an iframe at whatever pixel width it is
 * given, and that width is not advisory — the iframe does not shrink to fit.
 * A fixed 320 plus the card and page padding is wider than a 360px Android
 * viewport, so the sign-in card was pushed past the right edge of the screen
 * and "Forgot password" was clipped mid-word.
 *
 * It survived the four-width QA because the component returns null when
 * `CLIENT_ID` is unset, which is every local and CI environment. The overflow
 * only exists where Google actually loads: a real phone, in production.
 *
 * Google clamps this to 200–400 itself; passing something outside that range
 * silently gets a default, so measure the space we have and clamp to what the
 * API accepts.
 */
const GOOGLE_BUTTON_MIN_WIDTH = 200;
const GOOGLE_BUTTON_MAX_WIDTH = 400;

export function googleButtonWidth(available: number): number {
  if (!Number.isFinite(available) || available <= 0) return GOOGLE_BUTTON_MIN_WIDTH;
  return Math.round(Math.min(GOOGLE_BUTTON_MAX_WIDTH, Math.max(GOOGLE_BUTTON_MIN_WIDTH, available)));
}

export function GoogleSignInButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onCredentialRef = useRef(onCredential);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [failed, setFailed] = useState(false);
  onCredentialRef.current = onCredential;

  useEffect(() => {
    if (!CLIENT_ID) return;
    let active = true;
    loadGis()
      .then((api) => {
        if (!active || !containerRef.current) return;
        api.initialize({
          client_id: CLIENT_ID,
          callback: (response) => {
            if (response.credential) onCredentialRef.current(response.credential);
          },
        });
        const render = () => {
          const host = containerRef.current;
          if (!active || !host) return;
          host.innerHTML = "";
          api.renderButton(host, {
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "pill",
            width: googleButtonWidth(host.clientWidth),
          });
        };
        render();
        // A rotation changes the available width, and the iframe keeps the one
        // it was built with. Re-rendering is the only way to resize it.
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(render);
        observer?.observe(containerRef.current);
        cleanupRef.current = () => observer?.disconnect();
      })
      .catch(() => {
        if (active) setFailed(true); // offline / blocked — hide quietly, password login still works
      });
    return () => {
      active = false;
      cleanupRef.current?.();
    };
  }, []);

  if (!CLIENT_ID || failed) return null;

  // Defensive, not the fix. `overflow-x-clip` stops an oversized child painting
  // outside the host, but its layout box still extends — measured at 360px — so
  // these only stop the container adding width of its own. The measurement above
  // is what actually keeps the card on screen.
  return (
    <div
      ref={containerRef}
      className="flex min-h-[44px] w-full min-w-0 justify-center overflow-x-clip"
      data-testid="google-signin"
    />
  );
}
