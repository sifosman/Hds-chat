# HDS Chat

Business chat with William and HDS staff, delivered as an installable web app and a signed Android APK.

- Web: https://hds-chat.vercel.app
- Android pilot APK: https://expo.dev/artifacts/eas/Sxq09_dSzQOGF7XUJp-OEdx3TQ5Lj1Bt__41pJceJFk.apk
- [Progress](./PROGRESS.md) · [Launch readiness](./docs/LAUNCH-READINESS.md) · [Revised plan](./docs/PLAN.md) · [Android setup](./mobile/README.md)

## What is implemented

Text/photos/documents/voice notes/location; William's existing prompts and tools; quote/PDF/invoice views; existing hosted payment links; offline cache/outbox; realtime update hints; isolated staff handover; web-push implementation; Expo Android shell. The APK has **no native push yet** because Firebase/FCM is not configured.

This is an operational pilot, not a full WhatsApp clone or a claim of production certification. It does not provide customer-to-customer/group chat, calls, or end-to-end encryption. Bulk invitations and migration campaigns are not enabled.

## Local development

Use Node 24, then:

```sh
npm ci
npm run dev:api
npm run dev
npm run typecheck
npm test
npm run build
```

Copy the [environment template](./.env.example) to `.env.local` and provision secrets through the project owner. Never commit live workflow exports, credentials, APK signing material or customer transcripts. [Deployment exclusions](./.vercelignore) omit research, scratch files, n8n exports, credentials and mobile source from web builds.

The API and PWA are built together on Vercel. Supabase access is service-side and scoped to verified customer identity. Customers get opaque app sessions, **not** CRM Supabase Auth tokens. New `app_*` tables have RLS enabled and no browser-role access.

## William updates

The app workflow is generated from live William; don't edit it by hand:

```sh
python3 n8n/sync_app_workflow.py --dry-run
python3 n8n/sync_app_workflow.py
```

The shared HDS patch helper invokes that sync after prod patches. Deploy scripts that bypass the helper still need a manual sync. Changing an expected source anchor aborts instead of silently guessing. The source WhatsApp workflow is never rewritten by the generator.

- App conversation workflow: `nZy6oaIydjLzPmPz`
- Dedicated Chatwoot inbox: `4` (HDS App)
- App async update workflow: `YT7obMO6EMaA0Sa1`
- App-only error/watchdog workflow: `W4kvBGp4k37IGl3W`

With `TURN_RECOVERY_ENABLED=true`, generated app turns record completion only after a durable final reply (or explicit handover/debounce completion). Failed/stalled claims get a durable one-time notice; claimed quote/payment work is never blindly replayed. Existing claims are marked legacy so enabling recovery cannot produce old false alarms. Apply [migration 004](./db/migrations/004_turn_recovery.sql), deploy the API, then deploy/enable the recovery workflow before enabling that generator flag.

The [async reconciler](./server/reconcile.ts) imports only allowlisted customer-facing branch/resolver/legacy-staff messages and observes invoice status changes. It never marks an invoice paid or initiates a financial transaction. Initial observations are silent. Its bounded round-robin scanning is suitable for the staff pilot; benchmark before scaling.

## Tests

Local tests use mocks/fixtures. Live integration scripts use reserved `2790000xxxx` identities and shared HDS services. **They create test conversations and may create test quotes/invoices.** Do not substitute real customer phone numbers.

```sh
node tests/live-core.mjs
node tests/live-security.mjs
node tests/live-media.mjs
node tests/live-handover.mjs
node tests/live-parity.mjs
```

Use fresh reserved test phone arguments for repeated core/parity runs: n8n memory survives database cleanup, and existing valid quotes can retain an older promotion. The live pricing oracle reads the actual catalogue and ad eligibility, rather than hard-coding temporary prices. [Recovery fixtures](./tests/live-turn-recovery.mjs) exercise terminal callback ordering, delayed notices and final-delivery deduplication without running financial tools.

These are not interchangeable with provider payment-sandbox testing or real-device notification tests. See the readiness checklist for precisely what has and has not passed.

## Rollback / stop

1. Stop new invitations and revoke affected app sessions through the app tables.
2. Deactivate **only** the three HDS App workflows above if necessary.
3. Roll back the HDS Chat Vercel deployment to a known-good deployment.
4. Preserve app tables for audit/recovery; don't drop business data or remove existing WhatsApp workflows.

Native APK remains a shell loading the web deployment, so a web fix updates its UI without rebuilding Android. A native code/signing/permission change requires a fresh EAS build.
