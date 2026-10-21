const TOKEN_KEY = 'hds.token';
export const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined) || '';

export const auth = {
  get token() { return localStorage.getItem(TOKEN_KEY); },
  set(t: string) { localStorage.setItem(TOKEN_KEY, t); },
  clear() { localStorage.removeItem(TOKEN_KEY); },
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const requestToken = auth.token;
  if (requestToken) headers.Authorization = 'Bearer ' + requestToken;
  let r: Response;
  try {
    r = await fetch(API_BASE + '/api' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
  } catch {
    throw new ApiError(0, 'offline', 'No connection. Check your internet and try again.');
  }
  let j: any = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    if (r.status === 401 && requestToken && auth.token === requestToken) { auth.clear(); window.dispatchEvent(new Event('hds:logout')); }
    throw new ApiError(r.status, j?.error || 'error', j?.message || friendly(j?.error) || 'Something went wrong. Please try again.');
  }
  return j as T;
}

function friendly(code?: string) {
  return ({ rate_limited: 'Too many attempts. Please wait a few minutes.', unauthorized: 'Please sign in again.' } as Record<string, string>)[code || ''];
}

export interface AppConfig { supabase_url: string; supabase_key: string; vapid_public_key: string | null; android_apk_url: string | null }
let cfg: Promise<AppConfig> | null = null;
export const getConfig = () => (cfg ||= api<AppConfig>('/config').catch(error => { cfg = null; throw error; }));

/** Inside the Android app (Expo WebView)? */
export const native = {
  get on() { return typeof (window as any).ReactNativeWebView?.postMessage === 'function'; },
  post(msg: Record<string, unknown>) { (window as any).ReactNativeWebView?.postMessage(JSON.stringify(msg)); },
};

export function openExternal(url: string) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return; }
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return;
  if (native.on) native.post({ type: 'open', url: parsed.href });
  else window.open(parsed.href, '_blank', 'noopener,noreferrer');
}
