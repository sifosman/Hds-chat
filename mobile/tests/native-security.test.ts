import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { hardenWebView } = require('../plugins/withSecureWebView.js');
const root = path.resolve(import.meta.dirname, '..');
const nativePath = 'node_modules/react-native-webview/android/src/main/java/com/reactnativecommunity/webview';
const names = ['RNCWebView.java', 'RNCWebChromeClient.java', 'RNCWebViewClient.java', 'RNCWebViewManagerImpl.kt'];

test('native patches enforce origin/main-frame checks, no legacy bridge, safe downloads, and are idempotent', () => {
  const fixture = fs.mkdtempSync(path.join(root, '.native-security-test-'));
  try {
    fs.mkdirSync(path.join(fixture, nativePath), { recursive: true });
    for (const name of names) fs.copyFileSync(path.join(root, nativePath, name), path.join(fixture, nativePath, name));
    hardenWebView(fixture);
    const read = (name: string) => fs.readFileSync(path.join(fixture, nativePath, name), 'utf8');
    const bridge = read('RNCWebView.java');
    assert.ok(bridge.includes('if (isMainFrame && "https://chat.hdsgroup.co.za".equals(sourceOrigin.toString()))'));
    assert.ok(bridge.includes('Set.of("https://chat.hdsgroup.co.za")'));
    assert.ok(!bridge.includes('Set.of("*")'));
    assert.ok(!bridge.includes('addJavascriptInterface(fallbackBridge, JAVASCRIPT_INTERFACE);'));
    const chrome = read('RNCWebChromeClient.java');
    assert.ok(chrome.includes('android.net.Uri origin = request.getOrigin();'));
    assert.ok(chrome.includes('request.deny(); return;'));
    assert.ok(chrome.includes('callback.invoke(origin, false, false); return;'));
    const navigation = read('RNCWebViewClient.java');
    assert.ok(navigation.includes('shouldInterceptRequest(WebView view, WebResourceRequest request)'));
    assert.ok(navigation.includes('request.isForMainFrame()'));
    assert.ok(navigation.includes('origin.getUserInfo() == null'));
    assert.ok(navigation.includes('origin.getPort() == -1 || origin.getPort() == 443'));
    assert.ok(navigation.includes('endsWith(".pdf")'));
    const manager = read('RNCWebViewManagerImpl.kt');
    assert.ok(manager.includes('downloads use the same HTTPS-only browser routing; no cookie forwarding'));
    assert.ok(!manager.includes('module.downloadFile('));
    const first = names.map(read);
    hardenWebView(fixture);
    assert.deepEqual(names.map(read), first);
    fs.writeFileSync(path.join(fixture, nativePath, 'RNCWebView.java'), 'upstream source changed');
    assert.throws(() => hardenWebView(fixture), /security patch drift/);
  } finally {
    // Delete only this known, locally-created fixture; never a dependency or project directory.
    const resolved = path.resolve(fixture);
    assert.equal(path.dirname(resolved), root);
    assert.ok(path.basename(resolved).startsWith('.native-security-test-'));
    fs.rmSync(resolved, { recursive: true });
  }
});
