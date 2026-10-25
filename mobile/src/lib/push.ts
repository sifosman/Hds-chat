import { api } from './api';
import { initNotifications, pushPermissionStatus, registerPush } from '../push';
import type { NativePushStatus } from '../push';

export { initNotifications, pushPermissionStatus };
export type { NativePushStatus };

export type PushState = NativePushStatus;

/** Silent token refresh — call after sign-in. Prompts only via enablePush(). */
export async function refreshPush() {
  const status = await pushPermissionStatus();
  if (status !== 'granted') return;
  const { token } = await registerPush().catch(() => ({ status: 'unavailable' as const, token: undefined }));
  if (token) await api('/push/subscribe', { method: 'POST', body: { kind: 'expo', token } }).catch(() => {});
}

/** Must be called from a user gesture (button tap). */
export async function enablePush(): Promise<PushState> {
  const result = await registerPush();
  if (result.token) await api('/push/subscribe', { method: 'POST', body: { kind: 'expo', token: result.token } }).catch(() => {});
  if (result.status === 'denied' || result.status === 'default') void api('/events', { method: 'POST', body: { event: 'push_denied' } }).catch(() => {});
  return result.status;
}
