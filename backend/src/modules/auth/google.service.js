// Google sign-in verification — no SDK, no new dependencies.
//
// The frontend uses Google Identity Services, which hands us a signed ID token
// (RS256 JWT). We verify it against Google's published signing certs with the
// `jsonwebtoken` package the backend already uses for its own tokens:
//   - signature against the cert whose `kid` matches the token header
//   - audience must be OUR client id (a token minted for another app is rejected)
//   - issuer must be accounts.google.com
//   - the Google email must be verified (unverified emails can be squatted)
// Certs are cached per Google's cache-control max-age; an unknown `kid` forces
// one refresh to survive key rotation.

import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";

const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v1/certs";
const GOOGLE_ISSUERS = ["accounts.google.com", "https://accounts.google.com"];

let certCache = { certs: null, expiresAt: 0 };

export function isGoogleLoginConfigured() {
  return Boolean(env.GOOGLE_CLIENT_ID);
}

async function fetchGoogleCerts() {
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw new AppError("Could not reach Google to verify the sign-in. Please try again.", 503, "GOOGLE_CERTS_UNAVAILABLE");
  }
  const certs = await res.json();
  const cacheControl = res.headers.get("cache-control") ?? "";
  const maxAge = Number((cacheControl.match(/max-age=(\d+)/) ?? [])[1] ?? 3600);
  certCache = { certs, expiresAt: Date.now() + Math.max(60, maxAge - 60) * 1000 };
  return certs;
}

async function getGoogleCert(kid) {
  let certs = certCache.certs && Date.now() < certCache.expiresAt ? certCache.certs : await fetchGoogleCerts();
  if (!certs[kid]) certs = await fetchGoogleCerts(); // key rotation: refresh once
  return certs[kid] ?? null;
}

/** Verifies a GIS ID token; returns { sub, email, name } or throws a typed AppError. */
export async function verifyGoogleIdToken(credential) {
  if (!isGoogleLoginConfigured()) {
    throw new AppError("Google sign-in is not configured on this server.", 503, "GOOGLE_LOGIN_NOT_CONFIGURED");
  }
  const decoded = jwt.decode(String(credential ?? ""), { complete: true });
  const kid = decoded?.header?.kid;
  if (!kid) throw new AppError("Invalid Google credential.", 401, "GOOGLE_CREDENTIAL_INVALID");

  const pem = await getGoogleCert(kid);
  if (!pem) throw new AppError("Invalid Google credential.", 401, "GOOGLE_CREDENTIAL_INVALID");

  let claims;
  try {
    claims = jwt.verify(credential, pem, {
      algorithms: ["RS256"],
      audience: env.GOOGLE_CLIENT_ID,
      issuer: GOOGLE_ISSUERS,
    });
  } catch {
    throw new AppError("Google sign-in could not be verified. Please try again.", 401, "GOOGLE_CREDENTIAL_INVALID");
  }

  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  if (!claims.email || !emailVerified) {
    throw new AppError("This Google account has no verified email address.", 401, "GOOGLE_EMAIL_UNVERIFIED");
  }

  return {
    sub: String(claims.sub),
    email: String(claims.email).trim().toLowerCase(),
    name: claims.name ? String(claims.name) : null,
  };
}
