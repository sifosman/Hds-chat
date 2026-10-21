import { api, native } from './api';

const DONE = 'hds.install.done';
const markDone = () => { try { localStorage.setItem(DONE, '1'); } catch {} };

let deferred: any = null;
const listeners = new Set<() => void>();
window.addEventListener('beforeinstallprompt', (e: any) => {
  e.preventDefault(); deferred = e; listeners.forEach(l => l());
  api('/events', { method: 'POST', body: { event: 'install_prompt_shown' } }).catch(() => {});
});
window.addEventListener('appinstalled', () => {
  deferred = null; markDone(); listeners.forEach(l => l());
  api('/events', { method: 'POST', body: { event: 'installed', platform: platform() } }).catch(() => {});
});

export const onInstallChange = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const canPromptInstall = () => !!deferred;
export const isStandalone = () => native.on || window.matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
/** True once the app is installed — standalone mode, or the user accepted the prompt this browser. */
export const installDone = () => isStandalone() || localStorage.getItem(DONE) === '1';
export const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /android/i.test(navigator.userAgent);
export const platform = () => (native.on ? 'android-app' : isStandalone() ? 'pwa' : isIOS() ? 'ios-web' : isAndroid() ? 'android-web' : 'desktop');

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  deferred.prompt();
  const r = await deferred.userChoice;
  deferred = null; listeners.forEach(l => l());
  if (r?.outcome === 'accepted') { markDone(); api('/events', { method: 'POST', body: { event: 'install_accepted', platform: platform() } }).catch(() => {}); }
  return r?.outcome === 'accepted';
}
