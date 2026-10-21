import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { ASYNC_LIMITS, mapAsyncSource, nextInvoiceObservation, paidInvoiceMessage, type SourceRow } from '../server/reconcile.js';
import type { AppUser } from '../server/auth.js';

const user: AppUser = { id: '11111111-1111-4111-8111-111111111111', phone: '27821234567', name: null,
  realtime_topic: 'test-topic', status: 'active', created_at: '2026-10-21T10:00:00Z', wa_history_cutoff: '2026-10-21T10:00:00Z' };
const floor = '2026-10-21T11:00:00Z';
const source: SourceRow = { id: '22222222-2222-4222-8222-222222222222', phone_number: user.phone, role: 'assistant',
  message_text: 'Your payment has been confirmed by the branch.', created_at: '2026-10-21T11:01:00Z', tool_results: { branch_paycheck: true } };
const invoice = { id: '33333333-3333-4333-8333-333333333333', invoice_number: 'INV-001', quote_number: 'Q-20261021-1234-ab12cd34', status: 'paid' };

describe('async source allowlist and tenant isolation', () => {
  it('maps branch confirmation with stable source identity', () => {
    const out = mapAsyncSource(source, user, floor)!;
    expect(out.sender).toBe('system');
    expect(out.idempotency).toBe(`async-source:${user.id}:${source.id}`);
    expect(out.msg.payload).toMatchObject({ original_source: 'branch_paycheck', source_id: source.id });
  });
  it('maps resolver metadata without copying internal metadata into the app payload', () => {
    const out = mapAsyncSource({ ...source, tool_results: null, conversation_metadata: { source: 'ai_resolver', internal_draft: 'never expose' } }, user, floor)!;
    expect(out.sender).toBe('bot');
    expect(JSON.stringify(out)).not.toContain('never expose');
  });
  it('maps accepted legacy staff text with agent attribution', () => {
    const out = mapAsyncSource({ ...source, sender_name: 'HDS Agent', tool_results: { source: 'chatwoot_reply_bridge', sent: [{ type: 'text', messageId: 'wamid.accepted' }] } }, user, floor)!;
    expect(out).toMatchObject({ sender: 'agent', senderName: 'HDS Agent' });
  });
  it.each([
    { tool_results: { channel: 'app', branch_paycheck: true } },
    { conversation_metadata: { channel: 'app' } },
    { tool_results: { source: 'chatwoot_reply_bridge', channel: 'app', sent: [{ type: 'text', messageId: 'wamid' }] } },
    { tool_results: { automatic_internal: true, branch_paycheck: true } },
    { conversation_metadata: { private: true } },
    { role: 'tool' }, { role: 'user' }, { tool_results: {} },
    { phone_number: '27991234567' }, { id: 'not-a-source-id' },
    { created_at: '2026-10-21T10:00:00Z' }, // cutoff is exclusive
    { created_at: '2026-10-21T10:30:00Z' }, // post-cutoff, but before the silent bootstrap floor
    { created_at: 'invalid' }, { message_text: '' }, { message_text: 'x'.repeat(12001) },
  ])('rejects ineligible row %j', patch => expect(mapAsyncSource({ ...source, ...patch }, user, floor)).toBeNull());
  it('accepts full canonical plus-phone equivalents, never last-nine-digit matches', () => {
    expect(mapAsyncSource({ ...source, phone_number: '+' + user.phone }, user, floor)).not.toBeNull();
    expect(mapAsyncSource({ ...source, phone_number: '44821234567' }, user, floor)).toBeNull();
  });
  it('rejects inactive user and invalid cutoff', () => {
    expect(mapAsyncSource(source, { ...user, status: 'blocked' }, floor)).toBeNull();
    expect(mapAsyncSource(source, { ...user, wa_history_cutoff: 'invalid' }, floor)).toBeNull();
  });
  it.each([
    { sent: [] }, { sent: [{ type: 'text' }] }, { sent: [{ type: 'template', messageId: 'wamid' }] },
    { sent: [{ type: 'document', messageId: 'wamid', file: 'quote.pdf' }] },
  ])('does not invent customer text/media from failed or attachment-only staff sends', fields => {
    expect(mapAsyncSource({ ...source, tool_results: { source: 'chatwoot_reply_bridge', ...fields } }, user, floor)).toBeNull();
  });
  it('rejects attachment placeholder even with an old accepted text marker', () => {
    expect(mapAsyncSource({ ...source, message_text: '[attachments sent] quote.pdf' }, user, floor)).toBeNull();
  });
});

describe('durable invoice observation state machine', () => {
  it.each(['paid', 'pending', 'overdue', 'cancelled'])('silently baselines first %s observation', status => {
    expect(nextInvoiceObservation(null, status)).toEqual({ last_status: status, notify_pending: false, notified_at: null });
  });
  it('queues only an evidenced pending/overdue to paid transition', () => {
    for (const status of ['pending', 'overdue']) {
      expect(nextInvoiceObservation({ last_status: status, notify_pending: false, notified_at: null }, 'paid').notify_pending).toBe(true);
    }
    expect(nextInvoiceObservation({ last_status: 'cancelled', notify_pending: false, notified_at: null }, 'paid').notify_pending).toBe(false);
  });
  it('keeps pending flag on repeated scans after failed delivery', () => {
    const pending = { last_status: 'paid', notify_pending: true, notified_at: null };
    expect(nextInvoiceObservation(pending, 'paid')).toEqual(pending);
  });
  it('never sends pending/cancelled invoices even when a previous notification is queued', () => {
    const pending = { last_status: 'paid', notify_pending: true, notified_at: null };
    expect(paidInvoiceMessage({ ...invoice, status: 'pending' }, pending, user.id)).toBeNull();
    expect(paidInvoiceMessage({ ...invoice, status: 'cancelled' }, pending, user.id)).toBeNull();
  });
  it('never clears durable pending state in the pure observer, even after reversal', () => {
    expect(nextInvoiceObservation({ last_status: 'paid', notify_pending: true, notified_at: null }, 'cancelled').notify_pending).toBe(true);
  });
  it('does not notify an already delivered invoice twice', () => {
    const delivered = { last_status: 'pending', notify_pending: false, notified_at: '2026-10-21T11:00:00Z' };
    const next = nextInvoiceObservation(delivered, 'paid');
    expect(next.notify_pending).toBe(false);
    expect(paidInvoiceMessage(invoice, next, user.id)).toBeNull();
  });
  it('builds a conservative stored-state notice, not a collection/refund/payment-provider claim', () => {
    const out = paidInvoiceMessage(invoice, { last_status: 'paid', notify_pending: true, notified_at: null }, user.id)!;
    expect(out.idempotency).toBe(`invoice-paid:${user.id}:${invoice.id}`);
    expect(out.msg.body).toContain('is now marked paid');
    expect(out.msg.body).not.toMatch(/collection|ready|cleared|refund|R\d/);
    expect(out.msg.media_url).toBeUndefined();
  });
});

describe('bounded additive implementation and migration', () => {
  it('has explicit small pilot budgets', () => {
    expect(ASYNC_LIMITS.users).toBeLessThanOrEqual(10);
    expect(ASYNC_LIMITS.deliveries).toBeLessThanOrEqual(20);
    expect(ASYNC_LIMITS.budgetMs).toBeLessThan(60_000);
  });
  it('contains only app-table DDL and no upstream mutation or triggers', () => {
    const sql = readFileSync(new URL('../db/migrations/003_async_bridge.sql', import.meta.url), 'utf8');
    const statements = sql.replace(/--[^\n]*/g, '');
    expect(statements).not.toMatch(/\b(?:insert\s+into|update|delete\s+from|alter\s+table|create\s+table(?:\s+if\s+not\s+exists)?)\s+(?:public\.)?(?:invoices|quotes|ai_conversations)\b/i);
    expect(statements).not.toMatch(/create\s+(?:or\s+replace\s+)?trigger/i);
    expect(sql).toContain('references public.invoices(id)');
    for (const table of ['app_async_bridge_state', 'app_async_user_state', 'app_async_source_queue', 'app_invoice_observations']) {
      expect(sql).toContain(`alter table public.${table} enable row level security`);
    }
    expect(sql).toContain('from public, anon, authenticated');
  });
});
