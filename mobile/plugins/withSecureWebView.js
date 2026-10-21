const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const fs = require('node:fs');
const path = require('node:path');

// Pinned react-native-webview 13.15.0. Fail the build if upstream changes a patch
// anchor: silently shipping the wildcard Java bridge would be unsafe.
function replaceOnce(source, before, after, label) {
  if (source.includes(after)) return source;
  if (source.split(before).length !== 2) throw new Error(`HDS WebView security patch drift: ${label}`);
  return source.replace(before, after);
}
function hardenWebView(projectRoot) {
  const root = path.join(projectRoot, 'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview');
  const patch = (name, transforms) => {
    const file = path.join(root, name);
    let text = fs.readFileSync(file, 'utf8');
    for (const [before, after, label] of transforms) text = replaceOnce(text, before, after, label);
    fs.writeFileSync(file, text);
  };
  patch('RNCWebView.java', [
    ['RNCWebView.this.onMessage(message.getData(), sourceOrigin.toString());', 'if (isMainFrame && "https://hds-chat.vercel.app".equals(sourceOrigin.toString())) {\n                  RNCWebView.this.onMessage(message.getData(), sourceOrigin.toString());\n                }', 'bridge main frame'],
    ['Set.of("*")', 'Set.of("https://hds-chat.vercel.app")', 'bridge origin'],
    ['addJavascriptInterface(fallbackBridge, JAVASCRIPT_INTERFACE);', '// HDS: no origin-blind JavascriptInterface fallback. Update Android System WebView.\n            return;', 'legacy bridge disabled'],
  ]);
  const managerPath = path.join(root, 'RNCWebViewManagerImpl.kt');
  const managerSource = fs.readFileSync(managerPath, 'utf8');
  const downloadStart = '        webView.setDownloadListener(DownloadListener {';
  const start = managerSource.indexOf(downloadStart);
  const end = managerSource.indexOf('        return RNCWebViewWrapper(context, webView)', start);
  if (start < 0 || end < start) throw new Error('HDS WebView security patch drift: download listener');
  const downloadReplacement = `        webView.setDownloadListener(DownloadListener { url, _, _, _, _ ->
            // HDS: downloads use the same HTTPS-only browser routing; no cookie forwarding.
            webView.setIgnoreErrFailedForThisURL(url)
            val event = com.facebook.react.bridge.Arguments.createMap()
            event.putString("targetUrl", url)
            webView.dispatchEvent(webView, com.reactnativecommunity.webview.events.TopOpenWindowEvent(RNCWebViewWrapper.getReactTagFromWebView(webView), event))
        })
`;
  patch('RNCWebViewManagerImpl.kt', [[managerSource.slice(start, end), downloadReplacement, 'safe browser downloads']]);
  const originCheck = '"https".equals(origin.getScheme()) && "hds-chat.vercel.app".equals(origin.getHost()) && (origin.getPort() == -1 || origin.getPort() == 443) && origin.getUserInfo() == null';
  patch('RNCWebChromeClient.java', [
    ['public void onPermissionRequest(final PermissionRequest request) {', `public void onPermissionRequest(final PermissionRequest request) {\n        android.net.Uri origin = request.getOrigin();\n        if (!(${originCheck})) { request.deny(); return; }`, 'capture permission origin'],
    ['public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {', 'public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {\n        // Location is not provisioned by this shell. Never grant it silently.\n        if (origin != null) { callback.invoke(origin, false, false); return; }', 'location denied'],
  ]);
  // Enforce navigation natively too: upstream's JS callback times out to ALLOW.
  // External links are emitted for safe HTTPS-only browser routing, never loaded.
  patch('RNCWebViewClient.java', [
    ['    @TargetApi(Build.VERSION_CODES.N)', `    @Override\n    public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {\n        android.net.Uri origin = request.getUrl();\n        if (request.isForMainFrame() && !(${originCheck})) {\n            return new android.webkit.WebResourceResponse("text/plain", "UTF-8", new java.io.ByteArrayInputStream(new byte[0]));\n        }\n        return super.shouldInterceptRequest(view, request);\n    }\n\n    @TargetApi(Build.VERSION_CODES.N)`, 'main document request allowlist'],
    ['public boolean shouldOverrideUrlLoading(WebView view, String url) {', `public boolean shouldOverrideUrlLoading(WebView view, String url) {\n        android.net.Uri origin = android.net.Uri.parse(url);\n        if (!(${originCheck}) || (origin.getPath() != null && origin.getPath().toLowerCase(java.util.Locale.ROOT).endsWith(".pdf"))) {\n            com.facebook.react.bridge.WritableMap event = com.facebook.react.bridge.Arguments.createMap();\n            event.putString("targetUrl", url);\n            ((RNCWebView) view).dispatchEvent(view, new com.reactnativecommunity.webview.events.TopOpenWindowEvent(RNCWebViewWrapper.getReactTagFromWebView(view), event));\n            return true;\n        }`, 'native navigation allowlist'],
  ]);
}

module.exports = function withSecureWebView(config) {
  config = withAndroidManifest(config, (result) => {
    const manifest = result.modResults.manifest;
    manifest.application[0].$['android:usesCleartextTraffic'] = 'false';
    manifest.queries = manifest.queries || [];
    manifest.queries.push({ intent: [{ action: [{ $: { 'android:name': 'android.media.action.IMAGE_CAPTURE' } }] }] });
    return result;
  });
  return withDangerousMod(config, ['android', async (result) => {
    hardenWebView(result.modRequest.projectRoot);
    return result;
  }]);
};
module.exports.hardenWebView = hardenWebView;
