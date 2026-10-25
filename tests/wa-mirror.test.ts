import { describe, expect, it } from 'vitest';
import { mirrorCandidate } from '../server/messages.js';

const CUTOFF = Date.parse('2026-10-21T10:00:00Z');
const base = { id: '22222222-2222-4222-8222-222222222222', phone_number: '27821234567',
  created_at: '2026-10-21T11:00:00Z', message_text: 'Hello', sender_name: 'William' };

describe('wa mirror eligibility', () => {
  it('maps a customer whatsapp message to an incoming mirror', () => {
    const out = mirrorCandidate({ ...base, role: 'user' }, CUTOFF)!;
    expect(out).toMatchObject({ direction: 'in', sender: 'customer', sender_name: null, body: 'Hello' });
  });
  it('maps a bot reply to an outgoing mirror named William', () => {
    const out = mirrorCandidate({ ...base, role: 'assistant' }, CUTOFF)!;
    expect(out).toMatchObject({ direction: 'out', sender: 'bot', sender_name: 'William' });
  });
  it('maps chatwoot bridge replies to agent with staff name', () => {
    const out = mirrorCandidate({ ...base, role: 'assistant', sender_name: 'Elaine',
      tool_results: { source: 'chatwoot_reply_bridge' } }, CUTOFF)!;
    expect(out).toMatchObject({ direction: 'out', sender: 'agent', sender_name: 'Elaine' });
  });
  it('strips the image-analysis suffix and falls back to attachment placeholders', () => {
    expect(mirrorCandidate({ ...base, role: 'user', message_text: 'look at this\n[IMAGE ANALYSIS: secret stuff]' }, CUTOFF)!.body).toBe('look at this');
    expect(mirrorCandidate({ ...base, role: 'user', message_text: '', attachment_name: 'list.xlsx' }, CUTOFF)!.body).toBe('📎 list.xlsx');
    expect(mirrorCandidate({ ...base, role: 'user', message_text: '', attachment_url: 'https://x/y.jpg' }, CUTOFF)!.body).toBe('📷 Photo');
  });
  it.each([
    { role: 'tool' }, { role: 'system' },
    { tool_results: { channel: 'app' } }, { conversation_metadata: { channel: 'app' } },
    { tool_results: { automatic_internal: true } }, { conversation_metadata: { automatic_internal: true } },
    { tool_results: { private: true } }, { conversation_metadata: { private: true } },
    { created_at: '2026-10-21T10:00:00Z' }, // cutoff is exclusive
    { created_at: '2026-10-21T09:00:00Z' },
    { created_at: 'invalid' }, { id: 'not-a-uuid' },
    { message_text: '' }, { message_text: 'x'.repeat(12001) },
  ])('rejects non-mirrorable row %j', patch =>
    expect(mirrorCandidate({ ...base, role: 'user', ...patch }, CUTOFF)).toBeNull());
});
