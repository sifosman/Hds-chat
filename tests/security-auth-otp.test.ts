import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../server/db.js', () => ({ db: () => ({ from: f.from }) }));
vi.mock('../server/env.js', () => ({ ENV: { WA_TOKEN: 'fixture-wa', WA_PHONE_ID: 'fixture-phone-id', BREVO_API_KEY: '', SMS_PROVIDER: '', SMS_USER: '', SMS_PASS: '' }, isTestPhone: (p: string) => /^2790000\d{4}$/.test(p) }));
import { deliverOtp } from '../server/otp.js';
function result(data: unknown, error: unknown = null) {
  const q: any = {};
  for (const k of ['select', 'eq', 'order', 'limit']) q[k] = () => q;
  q.maybeSingle = async () => ({ data, error });
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true })));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('OTP delivery safety', () => {
  it('never sends to synthetic numbers even when called directly', async () => {
    expect(await deliverOtp('27900000001', '123456')).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each(['invalid', null, '2000-01-01T00:00:00Z', '2999-01-01T00:00:00Z'])('fails closed for invalid WhatsApp window %s', async created_at => {
    f.from.mockReturnValue(result({ created_at }));
    expect(await deliverOtp('27820000001', '123456')).toMatchObject({ ok: false, reasons: expect.arrayContaining(['wa_window_closed']) });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('fails closed if the customer-window lookup returns an error', async () => {
    f.from.mockReturnValue(result({ created_at: new Date().toISOString() }, { message: 'private diagnostic' }));
    expect(await deliverOtp('27820000001', '123456')).toMatchObject({ ok: false });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('uses a timeout for permitted delivery (all fetch calls mocked)', async () => {
    f.from.mockReturnValue(result({ created_at: new Date(Date.now() - 1000).toISOString() }));
    expect(await deliverOtp('27820000001', '123456')).toEqual({ ok: true, channel: 'whatsapp' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.mocked(fetch).mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });
  it('does not log an upstream error containing secrets or OTP values', async () => {
    f.from.mockReturnValue(result({ created_at: new Date(Date.now() - 1000).toISOString() }));
    vi.mocked(fetch).mockRejectedValue(new Error('private-gateway-key 123456'));
    expect(await deliverOtp('27820000001', '123456')).toMatchObject({ ok: false, reasons: expect.arrayContaining(['whatsapp_error']) });
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toMatch(/private-gateway-key|123456/);
  });
});
