import { api, getConfig, native } from './api';

const b64 = (s: string) => {
  const p = '='.repeat((4 - (s.length % 4)) % 4);
  const raw = atob((s + p).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
};

export type PushState = 'unsupported' | 'default' | 'granted' | 'denied' | 'native';

export function pushState(): PushState {
  if (native.on) return (window as any).__hdsNative?.pushStatus === 'granted' ? 'granted' : 'unsupported';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  return Notification.permission as PushState;
}

/** Must be called from a user gesture (button tap). */
export async function enablePush(): Promise<PushState> {
  if (native.on) { native.post({ type: 'push:register' }); return pushState(); }
  if (pushState() === 'unsupported') return 'unsupported';
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') { api('/events', { method: 'POST', body: { event: 'push_denied' } }).catch(() => {}); return perm as PushState; }
  const cfg = await getConfig();
  if (!cfg.vapid_public_key) return 'unsupported';
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(cfg.vapid_public_key) });
  const j = sub.toJSON();
  await api('/push/subscribe', { method: 'POST', body: { kind: 'webpush', endpoint: j.endpoint, keys: j.keys } });
  return 'granted';
}

/** Re-register an existing permission silently (new device session, rotated subscription). */
export async function refreshPush() {
  if (native.on) { native.post({ type: 'push:register' }); return; }
  if (pushState() === 'granted') enablePush().catch(() => {});
}

// The Android shell calls window.__hdsNative.onPushToken(token) after push:register
(window as any).__hdsNative = {
  ...((window as any).__hdsNative || {}),
  onPushToken: (token: string) => { if (token) api('/push/subscribe', { method: 'POST', body: { kind: 'expo', token } }).catch(() => {}); },
};
