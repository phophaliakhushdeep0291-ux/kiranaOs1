import { AppProviders } from "./providers";
import { AppRoutes } from "./routes";
import { ShellErrorBoundary } from "@/components/shared/ShellErrorBoundary";

/**
 * The boundary sits OUTSIDE the providers, not inside them.
 *
 * Page-level boundaries live in AppRoutes and catch anything a screen throws.
 * Nothing caught the shell — so a throw in a provider, the auth bootstrap, the
 * sync bridge or the toaster unmounted the whole root and left a blank page,
 * taking the sync timer with it. React only unwinds to a boundary ABOVE the
 * component that threw, so this has to be the outermost thing in the tree.
 */
function App() {
  return (
    <ShellErrorBoundary>
      <AppProviders>
        <AppRoutes />
      </AppProviders>
    </ShellErrorBoundary>
  );
}

export default App;
