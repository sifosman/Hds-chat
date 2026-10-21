# HDS Chat Android

Isolated Expo SDK 54 Android WebView shell for **https://hds-chat.vercel.app**. The parent PWA is deployed separately; this package does not bundle or deploy it.

- Android application ID: `za.co.hdsgroup.chat`
- EAS owner/project: `sifosman/hds-chat-android`
- EAS project ID: `18114d09-7139-421f-93b7-817c8f45678b`
- Preview profile: internally distributed **APK**; production profile: AAB.
- Successful preview build: `569b5746-7eec-4945-8df5-ae94aa4baced` ([EAS build](https://expo.dev/accounts/sifosman/projects/hds-chat-android/builds/569b5746-7eec-4945-8df5-ae94aa4baced)).
- [Download signed APK](https://expo.dev/artifacts/eas/Sxq09_dSzQOGF7XUJp-OEdx3TQ5Lj1Bt__41pJceJFk.apk) — version 1.0.0 / versionCode 1, minimum Android API 24, target API 36.
- APK SHA-256: `253ed8856c4a3184abb4f78ebaad765d3a7d4700da5bf27f63167656cbb3b106`.
- `apksigner verify --print-certs` succeeded. Signing certificate SHA-256: `E3:44:BB:38:85:F6:0A:A9:A0:AD:54:B2:EE:B9:65:99:20:F7:5B:0E:5E:C8:E9:AA:8B:57:80:BC:00:5C:AF:09`.
- `assetlinks.json` contains the verified fingerprint for the parent to deploy at `/.well-known/assetlinks.json`. Future Play Store builds may use a different Play App Signing certificate; add that fingerprint separately.
- App icons copied from the existing PWA `public/icons` source.
- This is a new project/signing identity, **not** the Funxon app.

## Develop and verify

```sh
cd mobile
npm ci
npm run typecheck
npm test
npx expo prebuild --platform android --no-install
npx expo run:android
# Existing signed-in Expo account; consumes existing plan build credit:
eas build --platform android --profile preview
```

Use an actual development/native build, **not Expo Go**, when testing security. Expo Go does not apply the Android config plugin. `android/`, caches and dependencies are ignored; EAS runs prebuild and applies the plugin to freshly installed pinned dependencies. Do not remove the plugin or update WebView without reviewing its patches and rebuilding. The plugin fails closed on source-anchor drift.

## Security model

Only exact `https://hds-chat.vercel.app` HTTPS origin may navigate inside the app (no user-info or alternate ports). External HTTPS links, popup links, PDF URLs and Android download responses go to a browser/custom tab without copying app authorization headers or cookies. `javascript:`, `file:`, `data:`, `blob:`, `intent:`, `http:`, and other schemes are blocked. External payment providers and PDF hosts are not added to the WebView trust list. Browser redirects are outside the WebView trust boundary.

`originWhitelist={['*']}` deliberately disables react-native-webview's implicit OS `Linking.openURL` fallback for non-allowlisted URLs. The **actual allowlist** is enforced in the native plugin and `src/security.ts`; wildcard is not permission to load arbitrary pages. The plugin blocks untrusted native navigation even when the JS navigation callback is late, and blocks untrusted main-document requests. API/image subresources can still use the PWA's existing remote HTTPS services.

The Android bridge uses AndroidX WebMessageListener with an exact allowed origin and a main-frame check. The origin-blind legacy `addJavascriptInterface` fallback is disabled. Older Android System WebView must be updated; ordinary web content may work but native bridge actions will not. Media capture permission requests are restricted to the trusted origin. WebView debugging, mixed content, file URL access, third-party cookies, cleartext network traffic, and Android backups are disabled. Geolocation is intentionally disabled/not provisioned in this initial shell.

Bridge messages match the existing PWA:

| Message | Behavior |
| --- | --- |
| `open` with HTTPS `url` | Open browser, never navigate external site in the app |
| `ready` | Publish native push availability status |
| `push:register` | Publish unavailable status and show an honest dismissible notice |
| `camera:request` | Shell-injected helper requests camera permission before file capture |

No session tokens are passed through the native bridge. Incoming payloads are size-limited, parsed and validated. Navigation and native origin checks are defense in depth, not protection against scripts already compromised on the trusted PWA origin; retain a restrictive PWA CSP.

## Native push: NOT configured / NOT working

Firebase Android configuration and FCM v1 service-account credentials are absent. This preview does not install/register Expo push notifications, request notification permission, fabricate a token, or call `window.__hdsNative.onPushToken` with an invalid value. It sets `window.__hdsNative.pushAvailable = false`, `pushStatus = 'unavailable'`, and emits `hds:native-push-status` with reason `firebase-not-configured`. A native banner explains that users must open the app to check messages.

The existing PWA currently classifies any native WebView as `native`, which is not proof of notification delivery. Parent should consume the availability status if changing PWA copy. Existing web push in a standalone browser is separate.

To enable later:

1. Create/register **this package** (`za.co.hdsgroup.chat`) in the correct HDS Firebase project. Do not reuse the Funxon package or signing identity.
2. Add `expo-notifications`, configure its plugin, and supply `google-services.json` through appropriate build configuration. Keep service-account private keys out of git, client bundles and logs.
3. Upload the correct FCM v1 service-account key to **this EAS project**, then rebuild.
4. On explicit registration, request Android notification permission and obtain the Expo token with the **HDS** EAS project ID. Deliver it into the trusted top-level page with `window.__hdsNative.onPushToken(token)` (JSON-escaped injection), which the PWA already sends to `/api/push/subscribe` as `kind: 'expo'`.
5. Handle rotation, foreground notifications, and validated notification-tap navigation. Test actual receipt on a physical Android device, including background/terminated states. Only then claim working push.

## Uploads, permissions and keyboard

- Existing HTML image/file inputs use Android's system picker with multiple selection. No broad storage/media-library permission is needed or requested.
- Captured photos request Camera only when the capture input is activated. Denial leaves Photos/Document available; permanently denied access can be changed in Android settings.
- Voice recording/getUserMedia uses the WebView's on-demand Android microphone permission flow, constrained by the native origin check. The PWA handles permission failures.
- Keyboard layout uses Android `adjustResize`; safe-area insets keep header/composer above system bars. Back first dismisses the Android keyboard normally, then navigates WebView history; at the root Android exits the activity.
- Offline/HTTP errors show a retry screen without deleting the signed-in web session.

## Deep links

`hds-chat://app/i/INVITE_TOKEN` maps to the trusted `/i/INVITE_TOKEN` path; cold/warm trusted HTTPS links are also handled. Arbitrary external URLs in intents are ignored. Android HTTPS auto-verification requires the parent to deploy `https://hds-chat.vercel.app/.well-known/assetlinks.json` with package `za.co.hdsgroup.chat` and **this APK's signing certificate SHA-256**. Obtain the fingerprint from this build/signing key, not Funxon. Until then HTTPS links may open in a browser instead; the custom scheme remains available. Existing PWA paths determine what a deep link displays.

## Physical-device acceptance checklist (not yet verified)

- Fresh install and sign-in; close/reopen retains session; logout clears PWA session.
- Chat, quotes and account; keyboard open/close, Android back, safe areas.
- Photos multi-select, document selection, camera allow/deny/permanent-deny, microphone allow/deny and recorded voice upload.
- External payments/PDFs open browser; returning preserves chat. Popup and download links behave similarly.
- Reject `javascript:`, `file:`, `intent:`, HTTP, deceptive hosts, credentials in URLs and untrusted bridge iframes.
- Custom-scheme invite cold/warm starts; verified HTTPS invite after assetlinks deployment.
- Offline launch/retry and process-recovery.
- Native push stays clearly unavailable until credentials and device delivery tests are complete.

## Cost and validation notes

Account usage was checked before build: an existing **Starter** plan (not Free) had $40 included build credit remaining, with no overage. No subscription change, purchase, or extra-cost approval was made. Do not automatically retry paid builds if credits are exhausted.

TypeScript and all five security tests passed, including native bridge/main-frame restrictions, navigation/download hardening, patch idempotence, and fail-closed upstream drift detection. Android Expo prebuild and Hermes JavaScript export (594 modules) passed. `expo install --check` could not finish because the environment blocked writes to the global `~/.expo/native-modules-cache`; it was not retried with broader access. Hardware behavior remains a device-test requirement, not a claimed result.
