import { APP_ORIGIN } from './security';

/** No auth/session data crosses this bridge. Native Android also validates origin. */
export const BOOTSTRAP = `
(function () {
  if (location.origin !== ${JSON.stringify(APP_ORIGIN)} || window !== window.top || window.__hdsShellInstalled) return;
  window.__hdsShellInstalled = true;
  window.__hdsNative = window.__hdsNative || {};
  window.__hdsNative.pushAvailable = false;
  window.__hdsNative.pushStatus = 'unavailable';
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

export const PUSH_UNAVAILABLE = `
(function () {
  if (location.origin !== ${JSON.stringify(APP_ORIGIN)} || window !== window.top) return;
  window.__hdsNative = window.__hdsNative || {};
  window.__hdsNative.pushAvailable = false;
  window.__hdsNative.pushStatus = 'unavailable';
  window.dispatchEvent(new CustomEvent('hds:native-push-status', { detail: { status: 'unavailable', reason: 'firebase-not-configured' } }));
})(); true;
`;
