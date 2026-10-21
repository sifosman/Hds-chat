# HDS Chat progress — 21 October 2026

## Current state

**Implemented and deployed as a staff-test pilot; not approved for mass customer migration.**

- Web: https://hds-chat.vercel.app
- Signed APK: https://expo.dev/artifacts/eas/Sxq09_dSzQOGF7XUJp-OEdx3TQ5Lj1Bt__41pJceJFk.apk
- Expo project: `@sifosman/hds-chat-android`, separate project and signing key from Funxon.
- App n8n workflow: `nZy6oaIydjLzPmPz`; app async updates: `YT7obMO6EMaA0Sa1`.
- Chatwoot inbox 4: **HDS App**, same eight staff members as the existing handover inbox.
- Existing WhatsApp customer workflow and original staff-reply bridge were not edited. The local shared patch helper gained a post-prod sync hook for the app copy.

## Built

- Revised architecture around existing Supabase, n8n William, quote engine and hosted payment links; no parallel pricing/payment implementation.
- App-only tables and service-role RPCs; opaque revocable sessions, single-use invites, atomic OTP attempts/expiry/replay prevention.
- React PWA, offline shell and IndexedDB outbox; photos, documents, voice, location, quote/PDF cards and quote list.
- Authenticated incremental sync with timestamp-and-ID cursors. Public realtime is only a wake-up hint, never trusted message content.
- Read/typing events, strict document ownership, callback idempotency and durable inbound-turn claims before William runs tools.
- Real Chatwoot staff replies and paused-bot customer replies through dedicated app inbox.
- Signed storage uploads and direct short-lived media downloads (avoids Vercel response-size limit).
- Web-push code and APK download/install guidance; Android native push deliberately unavailable until Firebase setup.
- Additive async notification projection for allowlisted branch/resolver/legacy-staff logs and observed invoice transitions. Existing source history and initially paid invoices baseline silently. It does not mark invoices paid.

## Verified

- **187 automated web/server tests** pass; TypeScript checks pass (initial build: 146; recovery/input/rich-card additions: 41).
- **5 native shell security tests**, native prebuild, Hermes export, EAS build, APK signature/package checks pass.
- Live app journey: 4 Premium White sheets → **R2,480**; quote card/PDF delivered; valid PDF bytes; resend creates no additional quote; sheet-count answer correct.
- Same scenario on WhatsApp test clone: **R2,480, HDS Church Street**, matching app result.
- Live media: cutting-list image read-back; PDF sizes/quantities read-back; audio transcription → 5 sheets/R3,100 quote.
- Live handover: inbox 4, actual staff reply received, actual private note hidden, customer reply routed back to staff.
- Live security: concurrent invite has one winner; unowned quote/payment links blocked; unknown customer cannot be proxied to WhatsApp; concurrent gateway callbacks deduplicate; revoked sessions blocked; push endpoint SSRF rejected.
- Browser: offline send survives offline page reload and appears exactly once after reconnect; quotes/detail/PDF UI opens.
- Atomic auth SQL also checked in a rolled-back database transaction: wrong code, correct code, replay, attempt cap and expiry.
- Async scheduler has successful executions; synthetic source-message relay tested separately (see evidence).

## Measured, not idealised

- Initial frontend JS approximately **132 KB gzip**, below 200 KB target.
- Live server acknowledgements **2.6–3.0 seconds** in the first journey, not the proposed 300 ms target.
- William replies **19–54 seconds** for tested scenarios. These are samples, not p95/load benchmarks.
- No physical Android device was connected. Signature/build verification is not device acceptance.

## Required before wider release

1. **Independent SMS provider credentials** (SMSPortal or BulkSMS) and real OTP delivery tests. Current fallback still depends on an eligible WhatsApp reply window. Email-on-file is not accepted as proof of phone ownership.
2. **Firebase/FCM configuration** and a new Android build for native notifications; real closed-app tests. PWA web-push receipt has not been certified on physical devices either.
3. Real Android install/camera/microphone/deep-link/checkout-return tests; iPhone PWA install/push tests.
4. Provider sandbox settlement/decline/duplicate-webhook/refund tests and backend review. The inspected PayFast ITN handler lacks an obvious invoice-status write; no production payment code was modified.
5. Broader William regression suite (hardware, quote revisions, branch payment claims, multilingual/error cases), load/performance/a11y testing, operational failure recovery and backup/restore drill.
6. Owner approval of privacy/retention/marketing consent and staged migration. No SMS blast or automatic WhatsApp invite line is enabled.
7. Reconcile scanned limits and notification retry strategy against expected pilot size. Current scanning is bounded/round-robin and push remains best-effort, not delivery-proof.

See [launch checklist](./docs/LAUNCH-READINESS.md) for release gates. Do not call this fully tested or fully WhatsApp-independent yet.
