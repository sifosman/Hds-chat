# HDS Chat Android

Expo SDK 54 **native** client for **https://chat.hdsgroup.co.za** (React Native UI over `src/screens` + `src/components`, backed by the same `/api` the PWA uses). The earlier WebView shell was retired; this package no longer embeds or ships web content.

- Android application ID: `za.co.hdsgroup.chat`
- EAS owner/project: `sifosman/hds-chat-android`
- EAS project ID: `18114d09-7139-421f-93b7-817c8f45678b`
- Preview profile: internally distributed **APK**; production profile: AAB.

## Develop and verify

```sh
cd mobile
npm ci
npm run typecheck
npm test                       # node --test on pure modules (security, session, recorder, outbox)
npx expo prebuild --platform android --no-install
npx expo run:android
# Existing signed-in Expo account; consumes existing plan build credit:
eas build --platform android --profile preview
```

Use an actual development/native build, **not Expo Go**.

## Migration note for existing installs

Users upgrading from the retired **WebView shell APK** must sign in **once**: the old build kept its session inside the WebView, while the native app stores the bearer token in `expo-secure-store`. There is no token migration — first launch shows the login screen. Quotes/history are server-side and reappear after sign-in.

## Auth and session model

- OTP login (`/auth/otp/start` + `/auth/otp/verify`) and invite links (`/auth/invite/peek` + `/auth/invite/redeem`); the invite token is only consumed by the explicit "Continue" POST.
- The bearer token lives in `expo-secure-store` via `src/lib/session.ts`: all store operations are serialized through one queue so a slow `set()` can never resurrect a cleared session, and an in-flight `load()` cannot overwrite a newer `set()`/`clear()`.
- Boot (`src/lib/boot.ts`) restores the session: a cached identity keyed by a hash of the exact token renders instantly offline, `/me` refreshes it, and boot always completes (no token or storage failure → login). Generation + token fences stop stale boot work after logout or token replacement.
- Logout and a 401 on the active token wipe the local SQLite cache, the durable outbox media directory, and the session.

## Entrance

The unauthenticated entrance (sign-in, code and invite screens) shares a separate visual system from the chat theme:

- `src/lib/entrance.ts` — entrance-only palette (warm ivory `#F6F2EA`, charcoal `#191C1A`, HDS red, WhatsApp green `#128C7E`) and the pure `launchRoute` precedence helper (session > invite > identity/URL pending > auth).
- `src/components/AuthScaffold.tsx` — shared static shell: anchored black masthead with the official logo, one edge-to-edge kitchen photograph (hidden on compact screens, small heights and while the keyboard is up), then a solid theme-coloured form surface. Used by `Login` and `Invite`.
- `src/components/WhatsAppButton.tsx` — branded WhatsApp messaging action (Ionicons `logo-whatsapp`, 48dp target). It is a support/recovery channel only — never an auth method; it opens the existing `wa.me/27787060895` draft link.
- The native splash (black, official mark) is hidden only after a drawable local frame; session restore and initial-URL resolution run concurrently so no local asset or font load can delay a signed-in user, an invite, or login readiness. The bundled font loads asynchronously behind a platform-face fallback.

### Entrance assets

- `assets/entrance/hero.jpg` — landscape crop derived from `kitchen-visualizer/public/images/generated-colors/liberty-oak.png` (internal HDS generated image). No remote or stock imagery.
- `assets/fonts/Jost.ttf` — the Jost variable font (wght 100–900, font-style normal) used on the HDS website, decoded from the site's self-hosted woff2 (`hdsgroup.co.za/.../jost-92zatbhpnqw73otd4g.woff2`, latin subset). Licence: SIL OFL 1.1 — full text in `assets/fonts/Jost-LICENSE.txt`. Loaded as `HDS-Jost`; if the load fails, entrance text falls back to the platform face.

### Dev-only entrance preview

In `__DEV__` builds, `hds-chat://dev-preview?state=NAME` (`phone`, `otp`, `no_channel`, `error`, `invite`, `invite_long`, `invite_invalid`, `invite_loading`; `off` exits) renders synthetic, fully inert entrance states for screenshots — no OTP is requested, no invite is peeked/redeemed and no session can be created through it. Never use it to reach real auth paths.

## Local-first chat

- Messages and the outbox persist in `expo-sqlite` (`src/lib/localdb.ts`); all writes are generation-fenced via `localWrite`.
- **Durable attachments** (`src/lib/outboxstore.ts`): send copies picker/cache files into `documentDirectory/outbox-media/<client_id>.<ext>` before enqueueing; only owned files are deleted (on ack, discard, or wipe) — never picker sources or foreign paths. A missing attachment fails the message with a re-attach hint instead of retrying forever.
- Server acknowledgement and outbox deletion happen in one SQLite transaction (`ldb.acknowledge`).
- Realtime is a wake-up hint only; authenticated API responses carry data.

## Voice notes

Hold-to-record (`src/lib/voicehold.ts` + `src/lib/voicerecorder.ts`): release/terminate/background while permission or `start()` is pending cancels the eventual recorder; teardown is serialized so presses never overlap native recorders; a stop finishing after terminate cannot send or clear newer UI. `<800 ms` holds cancel; slide-left cancels; a normal release sends once with the current reply context. AAC/m4a records natively — verify server transcription on device before release.

## Security model

- Only sanitized HTTPS URLs reach the system browser (`createExternalOpener` over `externalHttps`); no auth headers are ever attached to external pages. `http:`, `javascript:`, `file:`, `intent:` etc. are blocked.
- `hds-chat://app/i/TOKEN` and verified HTTPS app links map to trusted `/i/TOKEN` paths via `inviteToken` — exact path only, no suffixes.
- Navigation/deep-link validation lives in `src/security.ts` with node tests.

## Native push

Firebase is configured for **this package** (`za.co.hdsgroup.chat`) in Firebase project `hds-chat-app` — NOT the Funxon app or signing identity. `google-services.json` (client config, ships inside the APK) is committed; the FCM v1 service-account private key lives only in EAS credentials, never in git.

- `expo-notifications` registers the Expo push token (`ExponentPushToken`, project `18114d09-7139-421f-93b7-817c8f45678b`) to `/api/push/subscribe` as `kind: 'expo'`; the `messages` channel is created at startup.
- Notification taps route to the Chat tab; cold-start taps use `getLastNotificationResponseAsync`.

## Automated unauthenticated smoke (emulator)

`.maestro/unauthenticated-smoke.yaml` exercised by `scripts/test-emulator-smoke.sh` verifies the first-run experience against a dedicated test emulator only:

```bash
./scripts/test-emulator-smoke.sh            # defaults to emulator-5554
./scripts/test-emulator-smoke.sh emulator-5556
```

The script refuses non-`emulator-*` serials and verifies `adb emu avd name == HDS_Test_API35` before running, so it cannot touch a physical device. It never clears app data, never uninstalls, and never submits the login form (no OTP/invite/network mutation): it asserts the Login screen, types an invalid short number, dismisses the keyboard by defocusing the field, checks Home→resume (deep-link task-forward) and stop→relaunch, and repeats under OS night mode via `cmd uimode night` (verified through `dumpsys uimode` and restored on exit). Evidence (junit XML, per-pass logcat, screenshots, UI dumps, uimode dumps) lands in `/tmp/hds-device-smoke-<timestamp>/`.

Scope/limits: first launch + auth-gate only — requires the APK already installed on the emulator (`adb -s emulator-5554 install artifacts/hds-chat-native-v2-preview.apk`); it does not cover sign-in, push or chat features; runtime permission prompts are not exercised and launch commands do not auto-grant permissions (`permissions: { all: unset }`).

## Physical-device acceptance checklist (NOT verified on hardware — no device attached during development)

- [ ] Fresh install → login screen; OTP sign-in; close/reopen retains session; logout clears it.
- [ ] Invite link cold/warm start; `Continue` redeems once; token-change/unmount during redeem does not sign in.
- [ ] Offline launch shows cached messages; text queued offline sends on reconnect.
- [ ] Photo/document attach, airplane-mode send, file survives cache purge (outbox-media), retry after failure, discard removes the owned file.
- [ ] Voice note: hold/short-hold/slide-cancel/release-before-permission; m4a uploads and transcribes server-side.
- [ ] Swipe-to-reply on a bubble; carousels still scroll horizontally.
- [ ] Payment/PDF buttons open a browser tab; returning preserves the chat.
- [ ] Push received in background and killed states; tap opens the chat.
- [ ] Dark mode across screens; safe-area/inset layout on device.

## Historical: retired WebView shell

Version 1.0.0–1.1.2 builds were a native **WebView shell** around the PWA (bridge, `injected.ts` helpers, navigation allowlist). Those artifacts are no longer representative of the current app:

- Preview build `569b5746-7eec-4945-8df5-ae94aa4baced`; signed APK `253ed8856c4a3184abb4f78ebaad765d3a7d4700da5bf27f63167656cbb3b106` (signing cert `E3:44:BB:38:85:F6:0A:A9:A0:AD:54:B2:EE:B9:65:99:20:F7:5B:0E:5E:C8:E9:AA:8B:57:80:BC:00:5C:AF:09`).
- `assetlinks.json` for HTTPS app-link verification still needs that signing fingerprint deployed at `/.well-known/assetlinks.json`.

## Cost and validation notes

EAS account usage was checked before earlier builds: an existing **Starter** plan had build credit remaining, with no overage; no subscription change, purchase, or extra-cost approval was made. Do not automatically retry paid builds if credits are exhausted.

TypeScript and the node test suite (security, auth/session, boot, hold-to-record, recorder teardown, outbox storage) pass. Hardware behavior remains a device-test requirement, not a claimed result.
