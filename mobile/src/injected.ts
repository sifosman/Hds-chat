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
