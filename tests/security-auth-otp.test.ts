import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../server/db.js', () => ({ db: () => ({ from: f.from }) }));
vi.mock('../server/env.js', () => ({ ENV: { WA_TOKEN: 'fixture-wa', WA_PHONE_ID: 'fixture-phone-id', WA_OTP_TEMPLATE: 'hds_app_otp', BREVO_API_KEY: '', SMS_PROVIDER: '', SMS_USER: '', SMS_PASS: '' }, isTestPhone: (p: string) => /^2790000\d{4}$/.test(p) }));
import { deliverOtp } from '../server/otp.js';
function result(data: unknown, error: unknown = null) {
  const q: any = {};
  for (const k of ['select', 'eq', 'order', 'limit']) q[k] = () => q;
  q.maybeSingle = async () => ({ data, error });
  return q;
}
const sentBody = (i: number) => JSON.parse(String(vi.mocked(fetch).mock.calls[i][1]?.body));
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
  it.each(['invalid', null, '2000-01-01T00:00:00Z', '2999-01-01T00:00:00Z'])('sends the approved template when the WhatsApp window is closed (%s)', async created_at => {
    f.from.mockReturnValue(result({ created_at }));
    expect(await deliverOtp('27820000001', '123456')).toEqual({ ok: true, channel: 'whatsapp' });
    expect(fetch).toHaveBeenCalledOnce();
    const body = sentBody(0);
    expect(body.type).toBe('template');
    expect(body.template.name).toBe('hds_app_otp');
    expect(body.template.components[0].parameters[0].text).toBe('123456');
    expect(body.template.components[1]).toMatchObject({ type: 'button', sub_type: 'url', index: '0' });
    expect(body.template.components[1].parameters[0].text).toBe('123456');
  });
  it('sends the template when the customer-window lookup errors', async () => {
    f.from.mockReturnValue(result({ created_at: new Date().toISOString() }, { message: 'private diagnostic' }));
    expect(await deliverOtp('27820000001', '123456')).toEqual({ ok: true, channel: 'whatsapp' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(sentBody(0).type).toBe('template');
  });
  it('sends only the template even inside the open 24h window — never free-form', async () => {
    f.from.mockReturnValue(result({ created_at: new Date(Date.now() - 1000).toISOString() }));
    expect(await deliverOtp('27820000001', '123456')).toEqual({ ok: true, channel: 'whatsapp' });
    expect(fetch).toHaveBeenCalledOnce();
    expect(sentBody(0).type).toBe('template');
  });
  it('fails when the window is closed and the template send is rejected', async () => {
    f.from.mockReturnValue(result({ created_at: null }));
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 500 } as Response);
    expect(await deliverOtp('27820000001', '123456')).toMatchObject({ ok: false, reasons: expect.arrayContaining(['wa_tpl_http_500']) });
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
