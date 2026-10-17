# KiranaOS installed apps

The desktop app bundles the POS in an Electron window; Android and iOS bundle it
in Capacitor. There is no remote `server.url` and no browser tab is needed.
Existing local-first sales, inventory and outbox storage use each installation's
own IndexedDB. Browser data does **not** automatically move into the installed app.
Sign in online and finish device activation/sync before relying on offline billing.
Cloud transcription and AI reasoning still require internet and the server's
configured AI provider. No provider keys are packaged in these apps.

## Build

Use Node 22+, install the frontend with `pnpm install --frozen-lockfile`, then in
this directory run `npm ci` and `npm test`.

- Desktop: `npm run prepare:desktop`, then `npm start` or `npm run dist`.
  Windows uses NSIS, macOS DMG/ZIP, Linux AppImage. Build on the target OS.
- Android: `npm run prepare:mobile`, `npm run sync -- android`, then
  `cd android && ./gradlew assembleDebug`. Requires JDK 21 and Android SDK 36.
- iOS: `npm run prepare:mobile`, `npm run sync -- ios`, then open
  `ios/App/App.xcodeproj` in Xcode 26+. Select your development team for a phone.

`app-config.json` contains the public live API discovered from the live website.
`KIRANA_NATIVE_API_URL` is an optional **build-time** HTTPS `/api` override. There
is no runtime field that can redirect stored credentials to another server.
Desktop requests use a fixed-origin main-process proxy; mobile uses Capacitor's
native HTTP transport. The mobile adapter preserves client timeout/cancellation
when native POSTs finish late. Server writes still need existing idempotency.

The Installable apps GitHub workflow creates desktop installers, an Android
**test** APK and an iOS **simulator** build. Artifacts expire after 14 days.
Desktop artifacts are unsigned. A distributed Android app needs a stable release
keystore; a new CI debug key is not suitable for customer upgrades. iPhone/TestFlight
needs an Apple developer team and provisioning. Windows trusted signing and macOS
Developer ID signing/notarization are separate release steps. No store upload or
public release is performed by the workflow.

## Google sign-in (1.0.2)

The installed login screen always offers **Continue with Google**. Desktop opens
the system browser; Android/iOS use the official Capacitor Browser plugin (Custom
Tabs/Safari). The Google page runs on the HTTPS website in `app-config.json`, never
inside the desktop renderer or mobile app WebView. The app itself remains installed
and uses its bundled screens after signing in.

Deploy the matching frontend `/native-sign-in` page and backend `/auth/native/*`
routes before distributing this build. Keep the existing matching
`VITE_GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_ID` and Google's authorized JavaScript
website origin. Production also requires `REDIS_URL`; handoff storage fails closed
when Redis is unavailable. No additional Google client secret belongs in the app.
An older backend produces a visible update-required message, not a dead button.

The user enters the app's eight-digit code on the browser page, selects their
Google account/shop, and explicitly approves the app. Return to KiranaOS (close
the browser sheet on mobile if needed) to finish. Requests expire after five
minutes. The private 256-bit verifier stays in app memory and travels only in POST
bodies, never the browser URL; stored verifiers/codes are hashed. Google ID tokens
are bound to the request nonce. Redis performs atomic single-use redemption across
replicas. Approval creates no browser session/device slot. Redemption uses normal
device-bound authentication, plan limits and owner-PIN replacement. Cancel or a
changed/disabled account prevents sign-in. A lost final response requires starting
again; replay never issues another session.

`npm run smoke:google` clicks the real desktop button in a disposable profile,
checks external-browser dispatch, cancellation, missing-server feedback, and a
fixture approval returning to the dashboard. It does not prove real Google consent
or live deployment. Backend integration tests separately exercise signed ID-token
verification, nonce rejection, shop selection, device binding and device caps.

## Voice and permissions

The first floating mic tap opens the panel and requests recording. Permission
waits have a timeout and can be cancelled. Installed apps use MediaRecorder plus
the authenticated `/ai/transcribe` route, since embedded Web Speech may exist
without a functioning provider. Product/customer dictation uses the same fallback.
Permission errors remain visible and recordings stop after 15 seconds. Closing a
voice panel cancels its recording/upload; a late permission grant releases its mic.

Version 1.0.3 adds an app-specific microphone selector and a live input meter to
both assistant panels. The selected device is requested explicitly; a disconnected
selection produces a retry message rather than silently choosing another mic.
The meter uses the recording stream and is closed with it. Measured digital
silence is rejected before upload, and punctuation-only transcripts are rejected
by both the client and server. Short, quiet or unmeasurable recordings still reach
the provider. Exact English/Hindi navigation phrases, including the observed
“ओपन बिलेंग” transcription, can open their page without a model request.

For a live check, choose the built-in microphone, press Speak and verify that the
input meter moves while talking. Stop, review the captured text, then press Run
in the floating assistant. A typed command that opens a page is not speech proof.

Microphone and camera permissions are declared for Android/iOS/macOS. Android
backup is disabled so OS backup does not copy shop sessions/device identity to a
second installation. Desktop has sandboxed renderers, no Node/preload bridge,
fixed local navigation and a restrictive content policy. The local hardware bridge
still needs pairing and `kirana://app` in its allowed origins; existing pair tokens
in a browser profile are not transferred. OS printing/scanners and mobile file
sharing need device acceptance testing before using an installed app in a shop.

## Verification

`npm test` tests URL/path restrictions. The frontend release gate includes recording
startup failures, timeout/cancel cleanup, late audio, Web Speech timeout and native
HTTP cancellation. `npm run smoke:desktop` runs the actual bundled desktop shell
with a temporary profile and synthetic microphone. It never records real speech or
creates real shop records. The smoke probes public API health, checks permission
retry, real MediaRecorder bytes/track cleanup and the offline login shell. It then
uses an isolated fixture shop and transcription response to verify that one tap
on the real voice button starts recording and displays the returned transcript.
The smoke sends mouse input through the draggable mic button, uploads the captured
WebM over HTTP through the desktop proxy, and runs the actual server upload parser.
It checks the audio header, payload and compatible MIME type before returning the
fixture transcript. Version 1.0.1 also sends a plain audio media type so it works
with older servers that rejected MediaRecorder's `;codecs=opus` parameter.

Do not equate a successful build or synthetic audio with live provider accuracy.
Test actual speech with an authenticated shop and configured provider on each target
OS. Customer rollout also needs signing and printer/scanner/device testing.
