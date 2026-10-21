import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message || code); }
}

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;            // path after /api
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: any;
  rawBody: string;
  ip: string;
  params: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

async function readBody(req: IncomingMessage): Promise<string> {
  const pre = (req as any).body;
  if (pre !== undefined && pre !== null) {
    const body = typeof pre === 'string' ? pre : Buffer.isBuffer(pre) ? pre.toString('utf8') : JSON.stringify(pre);
    if (Buffer.byteLength(body, 'utf8') > 2_000_000) throw new HttpError(413, 'body_too_large');
    return body;
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req as any) {
    size += c.length;
    if (size > 2_000_000) throw new HttpError(413, 'body_too_large');
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function buildCtx(req: IncomingMessage, res: ServerResponse): Promise<Ctx> {
  const url = new URL(req.url || '/', 'http://x');
  let path = url.pathname.replace(/^\/api/, '') || '/';
  // vercel rewrite passes original path in ?__p
  if (url.searchParams.get('__p')) { path = '/' + url.searchParams.get('__p'); url.searchParams.delete('__p'); }
  const method = (req.method || 'GET').toUpperCase();
  const rawBody = method === 'GET' || method === 'HEAD' ? '' : await readBody(req);
  let body: any = {};
  if (rawBody) {
    try { body = JSON.parse(rawBody); } catch { throw new HttpError(400, 'invalid_json'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'invalid_json');
  }
  // Only Vercel's overwritten platform header is trusted; arbitrary X-Forwarded-For
  // supplied by direct clients must not give them a fresh rate-limit bucket.
  const fwd = process.env.VERCEL === '1' ? String(req.headers['x-vercel-forwarded-for'] || '').trim() : '';
  return { req, res, method, path, query: url.searchParams, headers: req.headers, body, rawBody, ip: isIP(fwd) ? fwd : req.socket?.remoteAddress || 'unknown', params: {} };
}

export function send(res: ServerResponse, status: number, data: unknown, headers: Record<string, string> = {}) {
  if (res.headersSent) return;
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

type Route = { method: string; re: RegExp; keys: string[]; h: Handler };
export class Router {
  routes: Route[] = [];
  on(method: string, pattern: string, h: Handler) {
    const keys: string[] = [];
    const re = new RegExp('^' + pattern.replace(/:(\w+)(\*)?/g, (_, k, star) => { keys.push(k); return star ? '(.*)' : '([^/]+)'; }) + '/?$');
    this.routes.push({ method, re, keys, h });
    return this;
  }
  async handle(req: IncomingMessage, res: ServerResponse) {
    let ctx: Ctx | null = null;
    try {
      ctx = await buildCtx(req, res);
      if (ctx.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
      for (const r of this.routes) {
        if (r.method !== ctx.method && r.method !== '*') continue;
        const m = ctx.path.match(r.re);
        if (!m) continue;
        r.keys.forEach((k, i) => (ctx!.params[k] = decodeURIComponent(m[i + 1] || '')));
        const out = await r.h(ctx);
        if (!res.headersSent && !res.writableEnded) send(res, 200, out ?? { ok: true });
        return;
      }
      send(res, 404, { error: 'not_found' });
    } catch (e) {
      const err = e as HttpError;
      // Paths (gateway keys / invite tokens), stacks, URLs, and upstream messages
      // can contain credentials. Log a fixed diagnostic, never the thrown value.
      if (err instanceof HttpError) {
        if (err.status >= 500) console.error('http_request_failed', err.status);
        send(res, err.status, { error: err.status >= 500 ? 'server_error' : err.code, message: err.status >= 500 ? 'Request failed. Please try again.' : err.message });
      } else {
        console.error('http_request_failed', 500);
        send(res, 500, { error: 'server_error' });
      }
    }
  }
}
