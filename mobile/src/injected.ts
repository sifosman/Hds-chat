import { APP_ORIGIN } from './security';

/** No auth/session data crosses this bridge. Native Android also validates origin. */
export const BOOTSTRAP = `
(function () {
  if (location.origin !== ${JSON.stringify(APP_ORIGIN)} || window !== window.top || window.__hdsShellInstalled) return;
  window.__hdsShellInstalled = true;
  window.__hdsNative = window.__hdsNative || {};
  window.__hdsNative.pushAvailable = true;
  window.__hdsNative.pushStatus = 'default';
  var pendingCamera = null;
  var skipCamera = false;
  window.__hdsNative.onCameraPermission = function(granted) {
    var input = pendingCamera; pendingCamera = null;
    if (granted && input && input.isConnected) {
      skipCamera = true;
      try { input.click(); } finally { skipCamera = false; }
    }
  };
  document.addEventListener('click', function(event) {
    var input = event.target;
    if (!skipCamera && input instanceof HTMLInputElement && input.type === 'file' && input.hasAttribute('capture') && window.ReactNativeWebView && typeof window.ReactNativeWebView.postMessage === 'function') {
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingCamera = input;
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'camera:request' }));
    }
  }, true);
})(); true;
`;

export type NativePushStatus = 'granted' | 'denied' | 'default' | 'unavailable';

export interface SafeInsets { top: number; bottom: number; left: number; right: number }

/**
 * Publishes the real OS insets into the page's CSS custom properties so the web
 * app — not the native shell — owns all top/bottom padding. env() covers PWA
 * browsers; the max() keeps whichever source reports the larger inset, so the
 * WebView can never double-pad or under-pad.
 */
export function safeAreaScript(i: SafeInsets): string {
  const px = (v: number) => Math.max(0, Math.round(v));
  return `(function(){try{if(location.origin!==${JSON.stringify(APP_ORIGIN)})return;var s=document.documentElement.style;s.setProperty('--safe-t','max(env(safe-area-inset-top,0px),${px(i.top)}px)');s.setProperty('--safe-b','max(env(safe-area-inset-bottom,0px),${px(i.bottom)}px)');s.setProperty('--safe-l','max(env(safe-area-inset-left,0px),${px(i.left)}px)');s.setProperty('--safe-r','max(env(safe-area-inset-right,0px),${px(i.right)}px)');}catch(e){}})();true;`;
}

/** Publishes the real native push state (and token, once known) into the trusted page. */
export function pushSyncScript(status: NativePushStatus, token?: string): string {
  const detail = JSON.stringify({ status, reason: status === 'unavailable' ? 'device-unsupported' : null });
  return `
(function () {
  if (location.origin !== ${JSON.stringify(APP_ORIGIN)} || window !== window.top) return;
  window.__hdsNative = window.__hdsNative || {};
  window.__hdsNative.pushAvailable = ${status !== 'unavailable'};
  window.__hdsNative.pushStatus = ${JSON.stringify(status)};
  ${token ? `window.__hdsNative.onPushToken?.(${JSON.stringify(token)});` : ''}
  window.dispatchEvent(new CustomEvent('hds:native-push-status', { detail: ${detail} }));
})(); true;
`;
}
