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
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("App screen crashed", error, info.componentStack);
  }

  reset = () => {
    this.setState({ hasError: false, message: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

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
