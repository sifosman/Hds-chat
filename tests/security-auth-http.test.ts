import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildCtx, HttpError, Router } from '../server/http.js';

function request(body: unknown = undefined, headers = {}, url = '/api/test') {
  return { body, headers, url, method: 'POST', socket: { remoteAddress: '127.0.0.1' } } as unknown as IncomingMessage;
}
function response() {
  return { headersSent: false, writableEnded: false, setHeader: vi.fn(), end: vi.fn(), statusCode: 0 } as unknown as ServerResponse;
}
beforeEach(() => { vi.spyOn(console, 'error').mockImplementation(() => {}); vi.stubEnv('VERCEL', ''); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('secret-safe HTTP handling', () => {
  it('never logs a gateway secret from path, rewrite query, exception URL, or stack', async () => {
    const router = new Router().on('POST', '/gateway/:secret/messages', () => { throw new Error('failed https://example.invalid/gateway/fixture-secret?token=fixture-token'); });
    const res = response();
    await router.handle(request({}, {}, '/api?__p=gateway/fixture-secret/messages'), res);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('http_request_failed', 500);
    expect(res.statusCode).toBe(500);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'server_error' }));
  });
  it('redacts custom server-error messages and codes too', async () => {
    const router = new Router().on('POST', '/test', () => { throw new HttpError(503, 'private-code', 'https://example.invalid/private-key'); });
    const res = response();
    await router.handle(request({}), res);
    expect(console.error).toHaveBeenCalledExactlyOnceWith('http_request_failed', 503);
    expect(res.end).toHaveBeenCalledWith(JSON.stringify({ error: 'server_error', message: 'Request failed. Please try again.' }));
  });
  it.each(['{bad', 'null', '[]', '"string"', '1'])('rejects invalid JSON body %s', async body => {
    await expect(buildCtx(request(body), response())).rejects.toMatchObject({ status: 400, code: 'invalid_json' });
  });
  it('limits pre-parsed request bodies as well as streamed bodies', async () => {
    await expect(buildCtx(request({ value: 'x'.repeat(2_000_001) }), response())).rejects.toMatchObject({ status: 413 });
  });
  it('ignores spoofed forwarded IPs on direct/local requests', async () => {
    const ctx = await buildCtx(request({}, { 'x-forwarded-for': '203.0.113.1', 'x-vercel-forwarded-for': '203.0.113.2' }), response());
    expect(ctx.ip).toBe('127.0.0.1');
  });
  it('uses only a validated platform IP when running on Vercel', async () => {
    vi.stubEnv('VERCEL', '1');
    const ctx = await buildCtx(request({}, { 'x-forwarded-for': '203.0.113.1', 'x-vercel-forwarded-for': '203.0.113.2' }), response());
    expect(ctx.ip).toBe('203.0.113.2');
    const malformed = await buildCtx(request({}, { 'x-vercel-forwarded-for': 'garbage' }), response());
    expect(malformed.ip).toBe('127.0.0.1');
  });
});
