# HDS Chat — own-channel plan (PWA + Android) — revised 21 Oct 2026

Supersedes the generic "Own-Platform Migration Plan" (plan.txt / milestone.txt / agentssuggestions.txt).
Those were written without knowledge of the HDS stack; this version is grounded in the inspected stack.

## Implementation corrections / release scope (21 October)

This document began as a proposal, not a completion report. Read [launch readiness](./LAUNCH-READINESS.md) and [progress](../PROGRESS.md) for verified status.

- The inspected Meta number reported a payment-method restriction. This does **not** establish the cause of the original spam lock, nor prove delivery of replies. Restoring a payment method may resolve that particular error; other Meta restrictions can remain.
- No Firebase/FCM configuration was found in the inspected projects; no claim is made that the organisation has no Firebase project.
- Public realtime topics now carry **only `{type:'sync'}`**, not message content, prices, URLs, statuses or typing data. The client refetches authenticated API data.
- OTP/invite consumption uses atomic service-role RPCs. Synthetic OTP bypass is explicitly disabled in production. Unverified CRM email is **not** accepted as proof of phone ownership; email sign-in is deferred.
- Duplicate input turns are claimed before n8n tools run. This prevents blind financial-tool replays; it is not a guarantee of recovery after every mid-workflow failure. Failure recovery/load testing remain launch gates.
- Unknown recipients cannot be proxied to WhatsApp; only canonical active branch numbers can. App-customer document/payment links are ownership-checked before delivery.
- The current app is business chat with William/staff, not a complete WhatsApp clone: no peer-to-peer/group chats, calls or end-to-end encryption.
- Loyalty, bulk SMS campaigns, automatic WhatsApp invitations, store release and native FCM remain deferred. No customer campaign was sent.
- The existing payment engine is reused, but live settlement/refund/provider-sandbox flows have **not** been certified by this project. In particular, the inspected PayFast ITN path sends email without an evident invoice-status mutation; that requires a separate backend review before broad rollout.
- New app migrations were applied additively to the existing HDS database, not a separate staging database. Tests use reserved synthetic numbers; this is a shared-environment pilot, not a fully isolated staging certification.

## 0. What we found (facts, 21 Oct 2026)

| Area | Reality |
|---|---|
| WhatsApp state | Number +27 67 902 0239 (phone id `1193389483847746`) is CONNECTED, quality GREEN, tier 250. **WABA `844753175346162` is BLOCKED for business-initiated messages: error 141006 "error with the payment method"**, business verification not passed (141010), display name not approved. Recent reply logs exist, but delivery receipts were not checked; these logs alone do not prove delivery. All template-based schedulers (check-in, nudge, spin, survey, visualiser, carpenter review, discontinued alerts) are **inactive**. Inbound volume fell to ~95 msgs today vs 260–730/day. |
| Bot | n8n `HDS WhatsApp AI Sales Assistant` prod `cyaeNrCXWi8YGQXa` (52 nodes) + clone `xaq7jm3eJolEDp5a` (test webhook `hds-whatsapp-test-media`). Patched almost daily via `Chatbot Tests/harness/patchlib.py` (clone then prod). |
| WhatsApp coupling in the bot | Inbound = Meta webhook JSON parsed by `Extract Meta Payload`. Outbound = 19 nodes POSTing `graph.facebook.com/v20.0/<phoneId>/messages` (text, document, image, interactive carousel/cta_url, read + typing_indicator, templates to branches) and 3 nodes GETting media `graph.facebook.com/v21.0/<mediaId>`. Everything else (prompt, 20 tools, Jev guard, quote engine, Supabase logging) is channel-agnostic and keyed on the phone number. |
| Data | One Supabase project (HDS, `xzsibbbghotreolzwnyk`) holds `ai_conversations` (bot memory + CRM view), `customer_profiles`, `quotes`, `invoices`, `branches`, `wa_templates`. The CRM (Next.js 16 on Vercel) reads it directly. |
| Payments | Already solved by the engine (`hds-nine.vercel.app`): Peach pay links `/api/pay?quoteId=…` (PayFlex at Peach branches), PayFast, EFT with branch confirmation. Nothing to rebuild. |
| Human handover | Chatwoot `chat.owdsolutions.co.za`, API inbox 3 "HDS AI Handovers"; staff replies go out through `HDS Chatwoot Reply Bridge` (filters inbox 3 only). |
| Security constraint | Several public tables have permissive `authenticated` RLS policies (e.g. `user_roles` FOR ALL USING true). **Customers must never receive a Supabase Auth JWT on this project** — that would let them read/escalate. |
| Tooling | EAS CLI logged in as `sifosman` (same account as Funxon). Vercel CLI token expired (needs `vercel login`). No Firebase/FCM configuration was found in the inspected projects (needed for native Android push). |

**Separate operational action:** review the payment method on the inspected Meta WABA (Business Settings → Payment methods). Meta reported error 141006. Resolving it may restore that sending capability, but does not establish or resolve the original reported spam lock or guarantee all restrictions are lifted.

## 1. Principles (kept from the original, adjusted)

1. **One brain, two channels.** The app talks to the *same* William: same prompt, tools, quote engine, Jev guard, Supabase tables. No re-implemented business logic.
2. **Don't touch the live WhatsApp bot** except one clearly flagged, reversible addition (the in-chat app invite, §6) which needs owner sign-off.
3. **Phone number is the identity** (E.164 digits `27…`, same format the bot already uses). An app user *is* their WhatsApp customer: same history, quotes, invoices, profile.
4. **Local-first, WhatsApp-fast UI.** Instant open from local cache, optimistic sends, offline outbox, ticks, typing.
5. **Built for SA networks.** Small bundle, image compression, voice notes, works on flaky 3G.
6. **Customers never touch the database directly.** Every read/write goes through our API with server-side scoping by phone.

## 2. What changed vs the generic plan, and why

| Generic plan | Revised | Why |
|---|---|---|
| New Fastify/NestJS backend, Redis, BullMQ, AWS Cape Town | **Vercel serverless API in the same project as the PWA + existing Supabase** | Matches the CRM/engine stack you already run and pay for; no new infra to operate. |
| Own WebSocket server, 5,000-socket k6 tests | **Supabase Realtime broadcast** on a per-user secret topic (data still fetched through our API) | Managed websockets; nothing to scale ourselves. |
| Re-plumb n8n into sub-workflows, new HMAC webhooks, rewrite reply nodes | **WhatsApp-Cloud-API-compatible gateway** in our API + an **auto-generated copy of prod William** where only `graph.facebook.com` → our gateway and the webhook path change | The bot's 52 nodes stay byte-identical in logic. A sync script regenerates the app copy from prod after every deploy, so the two never drift. |
| Rebuild Peach/PayFlex checkout, webhooks, reconciliation | **Reuse engine pay links**; the app shows a Pay button and a live paid/unpaid status from `invoices` | Already live and tested; rebuilding money flows is pure risk. |
| Loyalty ledger, tiers, referrals, backfill (M6) | **Deferred** to a later phase | No loyalty programme exists today; needs business rules (points per rand, value) first. Not needed for "as good as WhatsApp". |
| Supabase/Postgres customer auth | **Own opaque session tokens** (hashed, per device, revocable) | See security constraint above. |
| SMS blast as first contact | **Phase A: in-chat invite on WhatsApp** (free, compliant, reply inside the customer's open window) + **Phase B: SMS** once a provider is chosen | WhatsApp templates are blocked, and SMS needs a provider account. In-chat invites reach every active customer at zero risk. |
| Capacitor Android | **Expo app (EAS build, like Funxon)** wrapping the PWA in a WebView with native push, file/camera, back button, deep links | You already build with EAS; one web codebase means app updates ship without a Play Store release. |
| iOS later | Unchanged: the PWA works on iPhone (guided Add to Home Screen, push on iOS 16.4+). |

## 3. Architecture

```
 Customer (PWA / Android WebView)
   │  HTTPS (session token)                 ▲ realtime "message" events
   ▼                                        │ (Supabase broadcast, secret topic)
 hds-chat API (Vercel functions) ───────────┘
   │  ├─ auth: OTP / invite link / sessions
   │  ├─ messages: send, history (app + imported WhatsApp history), media upload
   │  ├─ quotes / invoices / branches (read, scoped to phone)
   │  ├─ push: Web Push (VAPID) + Expo push (FCM)
   │  └─ wa-compat gateway  /api/wa/v20.0/<id>/messages , /api/wa/v21.0/<mediaId>
   │
   │ Meta-format webhook (secret header)       ▲ Graph-format calls
   ▼                                           │
 n8n "HDS App Channel" = generated copy of prod William
   (same prompt, tools, Jev, engine, Supabase logging; graph.facebook.com → gateway)
   │
   ├─ Supabase: ai_conversations, quotes, invoices … (same rows the CRM shows)
   └─ Chatwoot inbox "HDS App" ── staff replies ──► /api/chatwoot/webhook ──► app
```

### 3.1 Gateway rules
- `messages` POST with `to` = an app user → stored as an app message, pushed in realtime, push notification if the app is closed. Returns a Meta-shaped `{messages:[{id:"wamid.APP…"}]}`.
- `status:'read'` / `typing_indicator` → read tick on the customer's message + "William is typing…".
- `to` = anyone else (branch managers for EFT checks) → proxied unchanged to the real Graph API, so branch flows keep working.
- Media GET → our stored upload (customer photos, voice notes, PDFs) so image/document/voice analysis works unchanged.
- Templates sent to an app user render from the `wa_templates` mirror as normal chat messages (no Meta block applies in-app).

### 3.2 Data model (new tables, all `app_` prefixed, RLS on, **no policies** — service role only)
- `app_users` (phone unique, name, realtime_topic, status, first/last seen, source)
- `app_sessions` (token_hash, device label/platform, created/last used, revoked_at)
- `app_auth_codes` (phone, purpose otp|invite, code/token hash, expires, attempts, consumed_at)
- `app_messages` (id, phone, direction, sender customer|bot|agent|system, type, body, media, payload jsonb, client_id unique for idempotency, wa_id, status sending|sent|delivered|read|failed, created_at)
- `app_media` (storage path, mime, size, owner phone)
- `app_push_subscriptions` (kind webpush|expo, endpoint/token, keys)
- `app_events` (funnel: invite_sent, opened, verified, installed, push_enabled, first_message…)
- `app_rate_limits` (key, window, count)
- Storage bucket `app-media` (private).
The bot keeps writing `ai_conversations` exactly as today, so the CRM, Sentinel, daily review and AI Advisor see app chats with no changes.

## 4. Customer experience (target: equal to WhatsApp, better where it matters)

Parity: text, photos (compressed), PDFs/documents, voice notes, location pin, ticks (sending/sent/delivered/read), William typing indicator, notifications, works offline, history.

Better than WhatsApp:
- **Full history on day one**: their previous WhatsApp conversation with William is shown (read-only, from `ai_conversations`).
- **Quote cards** in chat (number, total, branch, status, View PDF, **Pay now**), and a **Quotes tab** listing every quote and invoice with live paid/unpaid status.
- **Branch card** (address, hours, phone, map link) from `branches`.
- **Quick-reply chips** for the bot's carousel/buttons; product image carousels rendered natively.
- No Meta limits: no 24h window, no template approval, no spam lock — William can follow up any time (re-enable the check-in/nudge logic for app users later, under our own rules).

## 5. Sign-in & migration
- **Invite link** `https://<domain>/i/<token>` (256-bit, hashed, 72h, single use, redeemed by POST from a "Continue" button so link scanners can't burn it). Delivering the link to the customer's own WhatsApp/SMS proves they own the number.
- **OTP** (6 digits, 10 min, 5 attempts, rate-limited per phone/IP) for customers who open the app directly. Delivery providers are pluggable: SMS (provider TBC) and WhatsApp in-window reply. Email-on-file is not sufficient proof of phone ownership, so email sign-in is disabled. A dev/test mode accepts fixed codes for `2790000xxxx` test phones only when explicitly enabled; it is disabled in production.
- Sessions: opaque token per device, 180-day sliding expiry, "log out all devices".
- **Phase A migration (now):** a one-time, in-chat message from William to customers who message on WhatsApp: "We're moving to our own HDS app so we never lose your chat again — your quotes are already there: <invite link>". Once per customer, kill switch in `app_settings`. *Needs owner approval because it touches the live bot.*
- **Phase B:** SMS batches (recent buyers → quoting leads → cold) once an SMS provider is chosen; templates from milestone.txt; STOP handling; funnel tracking in `app_events`.

## 6. Android
Expo SDK 54 app `za.co.hdsgroup.chat`, EAS profiles copied from Funxon (`preview` = APK). WebView loads the PWA; native bridge provides: Expo push token (FCM), file/camera pickers, mic permission for voice notes, Android back button, external links (pay pages, PDFs) in Custom Tabs, app links for invite URLs. The PWA offers "Get the Android app" (APK/Play link) to Android visitors. **Native push needs a Firebase project** (google-services.json + FCM v1 key in EAS). Until then the PWA's Web Push covers Android Chrome users.

## 7. Testing (must pass before customers see it)
1. Unit: phone normalisation, token hashing/expiry, gateway payload translation (every message type the bot sends).
2. API integration against the real Supabase (test phones `2790000xxxx` only).
3. **Bot parity**: replay the harness scenarios (quote from typed list, photo cutting list, branch lookup, payment link, PDF resend, hardware, handover) through the app channel and the WhatsApp clone; compare tool calls, quote totals and replies.
4. Playwright E2E (mobile viewport): sign-in, send, offline outbox, reconnect without duplicates, quote card → PDF → pay link, voice note, image.
5. Android APK smoke on a real device: install, sign in, push, camera upload, pay link opens.
6. Security review: rate limits, token replay, IDOR (one customer can't read another's quote), no PII in logs.

## 8. Milestones (each ends with tests + PROGRESS.md entry)
| # | Milestone | Done when |
|---|---|---|
| M0 | Discovery + this plan | Implementation proceeded after the user's “continue”; wider launch still requires explicit review |
| M1 | DB schema, auth (OTP, invite, sessions), API skeleton, Vercel project | Test phone signs in on the deployed URL; replayed/expired links rejected |
| M2 | Chat core: PWA UI, local cache, outbox, realtime, ticks, media, history import | Message survives airplane mode and arrives exactly once |
| M3 | Bot bridge: gateway + generated n8n "HDS App Channel" + sync script + Chatwoot "HDS App" inbox | Parity suite passes; a staff reply in Chatwoot reaches the app |
| M4 | Quote/invoice/branch cards, Quotes tab, pay button, live status | Customer requests, views, opens PDF and pay link for a quote in the app |
| M5 | Push (Web Push + Expo), install/"Get set up" flow, deep links | Notification arrives with the app closed |
| M6 | Android app via EAS (APK) | APK installs on a real phone, signs in, chats, receives push |
| M7 | Hardening: security review, perf budget, runbook, rollback | All gates green |
| M8 | Pilot: staff → 50 customers via in-chat invite → wider; CRM channel badge | Pilot metrics OK |
| Later | SMS campaign, loyalty, app-only follow-ups, iOS store app, CRM analytics | When the data justifies it |

## 9. Rollback
- App channel is a separate n8n workflow + separate Vercel project: deactivate the workflow / remove the domain and the WhatsApp bot is untouched.
- The in-chat invite has a kill switch (`app_settings.invite_enabled=false`).
- No existing table, column, workflow node or CRM page is modified by M1–M7.

## 10. Open questions (defaults in brackets)
1. SMS provider for OTP + campaign? [SMSPortal or BulkSMS; build pluggable, OTP via eligible WhatsApp reply window until SMS is configured; private single-use invitations for staff testing]
2. Approve the one-time in-chat invite on the live WhatsApp bot? [yes, once per customer, kill switch]
3. Firebase project for Android push? [create one under the HDS Google account; app ships without native push until then]
4. Domain? [`chat.hdsgroup.co.za` — assigned to the Vercel project; `hds-chat.vercel.app` remains active]
5. App name/brand? ["HDS Group" with the existing HDS logo, chat persona William]
6. Re-run `vercel login` (token expired) so I can deploy.
