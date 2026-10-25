import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { APP_ORIGIN } from '../security';
import { createAuth } from './session';
import { createExternalOpener } from './external';

export const API_BASE = APP_ORIGIN;

export const auth = createAuth({
  getItem: k => SecureStore.getItemAsync(k),
  setItem: (k, v) => SecureStore.setItemAsync(k, v),
  deleteItem: k => SecureStore.deleteItemAsync(k),
});

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const requestToken = auth.token;
  if (requestToken) headers.Authorization = `Bearer ${requestToken}`;
  let r: Response;
  try {
    r = await fetch(API_BASE + '/api' + path, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, signal: opts.signal });
  } catch {
    throw new ApiError(0, 'offline', 'No connection. Check your internet and try again.');
  }
  let j: any = null;
  try { j = await r.json(); } catch { /* empty */ }
  if (!r.ok) {
    if (r.status === 401 && requestToken && auth.token === requestToken) { auth.clear(); notifyLogout(); }
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

export const openExternal = createExternalOpener(url => WebBrowser.openBrowserAsync(url, { showTitle: true }));

// The web client dispatched a window event; the native store calls a subscriber.
let onLogout: (() => void) | null = null;
export const setLogoutHandler = (fn: () => void) => { onLogout = fn; };
const notifyLogout = () => onLogout?.();
