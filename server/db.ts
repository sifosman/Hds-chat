import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { ENV } from './env.js';

let _db: SupabaseClient | null = null;
export function db(): SupabaseClient {
  if (!_db) {
    if (!ENV.SUPABASE_SECRET_KEY) throw new Error('SUPABASE_SECRET_KEY not set');
    _db = createClient(ENV.SUPABASE_URL, ENV.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _db;
}

export async function rateOk(key: string, windowSeconds: number, max: number): Promise<boolean> {
  // Authentication must never proceed without a positive limiter decision.
  try {
    const { data, error } = await db().rpc('app_rate_hit', { p_key: key, p_window_seconds: windowSeconds, p_max: max });
    if (error) { console.error('rate_limit_unavailable'); return false; }
    return data === true;
  } catch {
    console.error('rate_limit_unavailable');
    return false;
  }
}

export async function event(phone: string | null, name: string, meta: Record<string, unknown> = {}) {
  await db().from('app_events').insert({ phone, event: name, meta });
}

export async function setting<T>(key: string, fallback: T): Promise<T> {
  const { data } = await db().from('app_settings').select('value').eq('key', key).maybeSingle();
  return (data?.value as T) ?? fallback;
}

/** Realtime poke: broadcast to the user's secret topic. */
export async function broadcast(topic: string, _payload: Record<string, unknown>) {
  try {
    const r = await fetch(`${ENV.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { apikey: ENV.SUPABASE_SECRET_KEY, 'Content-Type': 'application/json' },
      // Public topics are untrusted hints only; never broadcast customer content.
      body: JSON.stringify({ messages: [{ topic, event: 'app', payload: { type: 'sync' }, private: false }] }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) console.error('broadcast failed', r.status);
  } catch { console.error('broadcast_unavailable'); }
}
