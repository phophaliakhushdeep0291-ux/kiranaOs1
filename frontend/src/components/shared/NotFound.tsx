import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home, SearchX } from "lucide-react";

/**
 * Sized in viewport units rather than `min-h-screen`: signed in this card now
 * renders inside the app shell's scroll area, where a full 100vh box would push
 * itself half a screen down and make a dead end something you have to scroll to.
 */
export default function NotFound() {
  return (
    <div className="app-page-shell flex min-h-[60dvh] items-center justify-center">
      <div className="max-w-lg rounded-lg border bg-card p-6 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <SearchX size={28} aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-black tracking-tight">Page not found</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This screen is not available. Your shop data is safe locally.
        </p>
        <Link href="/dashboard">
          <Button className="mt-5 min-h-11">
            <Home size={16} aria-hidden="true" />
            Go to dashboard
          </Button>
        </Link>
      </div>
    </div>
  );
}
