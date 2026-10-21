# Launch readiness — HDS Chat

**Decision: staff-test build available; wider customer rollout NOT signed off.** This is an evidence checklist, not a blanket claim that the application is fully tested.

## Results

| Gate | Status | Evidence / scope |
|---|---|---|
| PWA deployment and API | PASS | https://hds-chat.vercel.app; manifest, API health and signed-in browser checked |
| Android APK compilation/signature | PASS | EAS `569b5746-7eec-4945-8df5-ae94aa4baced`; package `za.co.hdsgroup.chat` |
| Unit/security/client regression | PASS | 146 tests across 10 web/server suites; 5 native security tests |
| Invite expiry/replay/concurrent redeem | PASS | Mock tests, actual SQL rollback assertions, live one-winner concurrent redemption |
| Customer isolation | PASS for tested routes | Foreign quote/payment documents, media ownership, client-ID conflict and revoked-session tests |
| Quote creation and PDF delivery | PASS | Live app: four Premium White sheets R2,480 at Church Street; valid PDF |
| Existing WhatsApp behaviour comparison | PASS for one scenario | Same full-sheet quote scenario gives same total and branch in WhatsApp clone |
| Quote resend | PASS | PDF resent without another quote row |
| Image, PDF and audio | PASS for fixtures | Real n8n download/analysis/transcription; [media evidence](./evidence/live-media-result.json) |
| Staff handover | PASS | Real Chatwoot inbox 4 public/private/customer-reply paths |
| Offline text/reload/reconnect | PASS | Deployed browser: one queued row, one after offline reload, one after reconnect |
| Pagination beyond 200 and logout races | PASS in tests | 401-row cursor fixture and generation-fenced asynchronous callbacks; not a load test |
| Async source relay | PASS for synthetic source | Scheduler successful; allowlisted source imported exactly once |
| Async invoice-paid transition | PARTIAL | Durable state/eligibility tests pass; no real/sandbox payment settlement exercised |
| Web push | UNVERIFIED on devices | Code/subscription handling implemented; no physical closed-app delivery certification |
| Android push | NOT CONFIGURED | Firebase/FCM required; APK accurately reports unavailable |
| Real Android device acceptance | NOT RUN | No device connected; emulator/build checks are not a substitute |
| SMS OTP delivery | NOT CONFIGURED | Provider adapter exists; no SMS credentials or delivery evidence |
| WhatsApp-independent onboarding | NOT COMPLETE | Invite links work; direct phone sign-in still needs independent SMS for reliability |
| Payment provider sandbox matrix | NOT RUN | No purchases/refunds made; existing engine reused |
| Comprehensive William regression | PASS for core scenarios | 20/20 live checks app vs WhatsApp clone: hardware add-on (R1,404 both), 4→6-sheet revision (R4,080 both), payment-claim gate holds (no branch check without a claim), Afrikaans quote (R1,360 both), gibberish handled. Not exercised: positive paid-claim path (needs owner sandbox); load/latency benchmarks separate |
| Load, p95 latency, battery/data, accessibility audit | NOT RUN | Small bundle and functional checks are not these benchmarks |
| Privacy/retention/compliance review | PENDING owner review | Draft in-app privacy/pilot notice; not legal sign-off |
| Campaign/production launch approval | PENDING | No mass messages, automatic WA invites or Play Store release |

## Important operational limits

- This is business chat with William/staff, not WhatsApp peer-to-peer/groups/calls, and it is not end-to-end encrypted.
- Additive app tables live in the same HDS Supabase project. Synthetic test identities are isolated by number, but a separate staging copy has not been established.
- The original HDS stack contains a permissive `authenticated_all_user_roles` policy. App users therefore do not receive Supabase Auth JWTs. That upstream risk has not been changed by this project. [Supabase RLS guidance](https://supabase.com/docs/guides/database/postgres/row-level-security).
- New app tables intentionally use RLS with no client policies (service-role-only API access). The linter's corresponding informational warning is intentional, not an invitation to grant browser access. [Linter explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- A successful push HTTP request is not proof the handset displayed a notification. Push is currently best-effort; quiet-hours preferences/durable provider receipt reconciliation remain future work.
- Inbound turn claims prevent duplicate financial-tool execution. A workflow failing after its claim needs operational review rather than blind replay; a complete automated recovery/dead-letter workflow remains a launch gate.
- Async reconciliation starts silently, scans bounded batches, and revisits invoices by ID because upstream invoice updates have no reliable updated-at cursor. It does not infer payment from browser redirects.
- Some media processed by the existing William workflow is mirrored through existing engine storage for CRM compatibility. The new upload bucket is private; this does not retrofit all legacy document/media storage permissions.
- Measured acknowledgement time was 2.6–3.0 seconds and William reply times 19–54 seconds. The proposed sub-300ms acknowledgement/p95 target has not been met or benchmarked.
- No independent security penetration test, backup restore, real-device accessibility review, financial-provider sandbox certification or high-concurrency soak test has been claimed.

## Next acceptance session

1. Owner installs the APK on an actual Android phone and opens the PWA on Android/iPhone.
2. Configure SMS, test valid/wrong/expired codes and delivery failures, then verify existing quotes/history for a staff-owned phone.
3. Configure Firebase/FCM and test notifications with app closed, foregrounded, logged out and network interrupted.
4. On sandbox payment credentials, exercise successful/declined/abandoned/duplicate settlement and verify invoice status, app card and notification agree.
5. Run a small named staff cohort, then approve a limited customer pilot. Keep outbound migration switched off until consent, support and rollback checks are signed off.
