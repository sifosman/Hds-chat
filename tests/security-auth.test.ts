import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Ctx } from '../server/http.js';

const f = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn(), rate: vi.fn(), event: vi.fn(), deliver: vi.fn() }));
vi.mock('../server/db.js', () => ({ db: () => ({ rpc: f.rpc, from: f.from }), rateOk: f.rate, event: f.event }));
vi.mock('../server/otp.js', () => ({ deliverOtp: f.deliver }));
vi.mock('../server/env.js', () => ({ ENV: { TEST_OTP_CODE: '123456', PUBLIC_URL: 'https://example.invalid', INTERNAL_KEY: 'test-only-internal' }, isTestPhone: (p: string) => /^2790000\d{4}$/.test(p) }));
import { createInvite, inviteRedeem, otpStart, otpVerify, requireSession } from '../server/auth.js';
import { sha256 } from '../server/util.js';

const phone = '27900000001';
const ctx = (body: any = {}) => ({ body, headers: {}, ip: '127.0.0.1' }) as Ctx;
const user = { id: 'user-fixture', phone, status: 'active', name: 'Fixture', realtime_topic: 'topic-fixture' };
function query(result: unknown) {
  const q: any = {};
  for (const k of ['select', 'eq', 'is', 'insert', 'update', 'order', 'limit']) q[k] = vi.fn(() => q);
  q.single = q.maybeSingle = vi.fn(async () => result);
  q.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
  return q;
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('TEST_AUTH_ENABLED', 'true');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('network forbidden in auth tests'); }));
  f.rate.mockResolvedValue(true);
  f.event.mockResolvedValue(undefined);
  f.from.mockImplementation((table: string) => {
    if (table === 'app_users') return query({ data: user, error: null });
    if (table === 'app_sessions') return query({ data: { id: 'session-fixture' }, error: null });
    throw new Error('unexpected table ' + table);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('atomic OTP handlers', () => {
  it('requires explicit synthetic auth enablement even with a configured fixed code', async () => {
    vi.stubEnv('TEST_AUTH_ENABLED', '');
    await expect(otpStart(ctx({ phone }))).rejects.toMatchObject({ code: 'invalid_phone' });
    await expect(otpVerify(ctx({ phone, code: '123456' }))).rejects.toMatchObject({ code: 'invalid_code' });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.deliver).not.toHaveBeenCalled();
  });
  it('issues a synthetic OTP only through the atomic RPC and never delivers it', async () => {
    f.rpc.mockResolvedValue({ data: { status: 'issued' }, error: null });
    await expect(otpStart(ctx({ phone }))).resolves.toMatchObject({ ok: true, channel: 'test' });
    expect(f.rpc).toHaveBeenCalledWith('app_auth_issue_otp', { p_phone: phone, p_code_hash: sha256(phone + ':123456'), p_channel: 'test' });
    expect(f.from).not.toHaveBeenCalled();
    expect(f.deliver).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not report success when atomic issuance fails', async () => {
    f.rpc.mockResolvedValue({ data: null, error: { message: 'private database diagnostic' } });
    await expect(otpStart(ctx({ phone }))).rejects.toMatchObject({ code: 'auth_unavailable', status: 503 });
    expect(f.event).not.toHaveBeenCalled();
  });
  it('denies all authentication work on a rejected rate decision', async () => {
    f.rate.mockResolvedValue(false);
    await expect(otpStart(ctx({ phone }))).rejects.toMatchObject({ status: 429 });
    await expect(otpVerify(ctx({ phone, code: '123456' }))).rejects.toMatchObject({ status: 429 });
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each(['12345', 'abc123456', '123 456', 123456, null])('rejects malformed code %s before touching storage', async code => {
    await expect(otpVerify(ctx({ phone, code }))).rejects.toMatchObject({ code: 'invalid_code' });
    expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(['expired', 'wrong_code', 'too_many_attempts'])('does not create a session for %s', async status => {
    f.rpc.mockResolvedValue({ data: { status }, error: null });
    await expect(otpVerify(ctx({ phone, code: '123456' }))).rejects.toMatchObject({ code: status });
    expect(f.from).not.toHaveBeenCalled();
  });
  it.each([null, true, { status: 'unexpected' }])('fails closed on malformed RPC result', async data => {
    f.rpc.mockResolvedValue({ data, error: null });
    await expect(otpVerify(ctx({ phone, code: '123456' }))).rejects.toMatchObject({ status: 503 });
    expect(f.from).not.toHaveBeenCalled();
  });
  it('fails closed on a thrown RPC error without disclosing its text', async () => {
    f.rpc.mockRejectedValue(new Error('https://example.invalid/gateway/private-key'));
    await expect(otpVerify(ctx({ phone, code: '123456' }))).rejects.toMatchObject({ code: 'auth_unavailable', message: 'Sign-in is temporarily unavailable. Please try again.' });
    expect(f.from).not.toHaveBeenCalled();
  });
  it('creates only an opaque app session after successful atomic consumption', async () => {
    f.rpc.mockResolvedValue({ data: { status: 'verified' }, error: null });
    const response = await otpVerify(ctx({ phone, code: '123456' }));
    expect(response.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(response.token).not.toContain('.');
    expect(response).not.toHaveProperty('access_token');
    expect(response).not.toHaveProperty('refresh_token');
    expect(f.rpc).toHaveBeenCalledExactlyOnceWith('app_auth_verify_otp', { p_phone: phone, p_code_hash: sha256(phone + ':123456') });
    const sessionQuery = f.from.mock.results.find((_, i) => f.from.mock.calls[i][0] === 'app_sessions')!.value;
    expect(sessionQuery.insert).toHaveBeenCalledWith(expect.objectContaining({ token_hash: sha256(response.token) }));
  });
});

describe('invite and session boundaries', () => {
  it.each(['used', 'expired', 'invalid_link'])('denies atomic invite outcome %s', async status => {
    f.rpc.mockResolvedValue({ data: { status }, error: null });
    await expect(inviteRedeem(ctx({ token: 'a'.repeat(43) }))).rejects.toMatchObject({ code: status });
    expect(f.from).not.toHaveBeenCalled();
  });
  it('redeems invite in one RPC and creates only an app session', async () => {
    f.rpc.mockResolvedValue({ data: { status: 'verified', phone, channel: 'manual' }, error: null });
    const result = await inviteRedeem(ctx({ token: 'a'.repeat(43) }));
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(f.rpc).toHaveBeenCalledWith('app_auth_redeem_invite', { p_code_hash: sha256('a'.repeat(43)) });
    expect(f.from.mock.calls.every(([table]) => table !== 'app_auth_codes')).toBe(true);
  });
  it('does not return an invitation if storage failed', async () => {
    f.from.mockReturnValue(query({ error: { message: 'private diagnostic' } }));
    await expect(createInvite(phone)).rejects.toMatchObject({ status: 503 });
    expect(f.event).not.toHaveBeenCalled();
  });
  it.each(['invalid-date', null, '2000-01-01T00:00:00Z'])('rejects invalid or expired session expiry %s', async expires_at => {
    f.from.mockReturnValue(query({ data: { id: 'session', expires_at, app_users: user }, error: null }));
    await expect(requireSession({ ...ctx(), headers: { authorization: 'Bearer ' + 'a'.repeat(43) } })).rejects.toMatchObject({ status: 401 });
  });
  it('rejects Supabase-shaped JWT credentials before querying storage', async () => {
    await expect(requireSession({ ...ctx(), headers: { authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature' } })).rejects.toMatchObject({ status: 401 });
    expect(f.from).not.toHaveBeenCalled();
  });
});
