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

export function GoogleSignInButton({ onCredential }: { onCredential: (credential: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onCredentialRef = useRef(onCredential);
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
        containerRef.current.innerHTML = "";
        api.renderButton(containerRef.current, {
          theme: "outline",
          size: "large",
          text: "continue_with",
          shape: "pill",
          width: 320,
        });
      })
      .catch(() => {
        if (active) setFailed(true); // offline / blocked — hide quietly, password login still works
      });
    return () => {
      active = false;
    };
  }, []);

  if (!CLIENT_ID || failed) return null;

  return <div ref={containerRef} className="flex min-h-[44px] justify-center" data-testid="google-signin" />;
}
