// Hand-off between "Continue with Google" on the login page and the registration form.
// When Google sign-in hits an email with no account yet, we stash the verified identity
// here and send the user to the normal registration form, prefilled. They still choose a
// password (accounts must work when Google is unreachable — this is an offline-first POS);
// their first Google sign-in AFTER registering links the account permanently by email.

const KEY = "kiranaos.google.signup.v1";

export interface GoogleSignupPrefill {
  email: string;
  name?: string | null;
}

export function stashGoogleSignupPrefill(prefill: GoogleSignupPrefill): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(prefill));
  } catch {
    // Storage blocked (private mode) — registration just starts blank.
  }
}

export function consumeGoogleSignupPrefill(): GoogleSignupPrefill | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as GoogleSignupPrefill;
    return typeof parsed?.email === "string" && parsed.email ? parsed : null;
  } catch {
    return null;
  }
}
