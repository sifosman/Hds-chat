import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { APP_ORIGIN, HOME_URL, appDeepLink, externalHttps, isTrustedUrl, navigationAction, parseBridgeMessage } from './src/security';
import { BOOTSTRAP, PUSH_UNAVAILABLE } from './src/injected';

function Shell() {
  const web = useRef<WebView>(null);
  const currentUrl = useRef(HOME_URL);
  const canGoBack = useRef(false);
  const cameraBusy = useRef(false);
  const browserBusy = useRef(false);
  const [uri, setUri] = useState(HOME_URL);
  const [initialReady, setInitialReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [pushNotice, setPushNotice] = useState(false);
  const [webKey, setWebKey] = useState(0);

  const openBrowser = useCallback(async (candidate: string) => {
    const url = externalHttps(candidate);
    if (!url || browserBusy.current) return;
    browserBusy.current = true;
    try { await WebBrowser.openBrowserAsync(url, { showTitle: true, toolbarColor: '#ffffff' }); }
    catch { Alert.alert('Cannot open link', 'Please try again when a browser is available.'); }
    finally { browserBusy.current = false; }
  }, []);

  const navigate = useCallback((candidate: string) => {
    const url = appDeepLink(candidate);
    if (!url) return;
    currentUrl.current = url;
    canGoBack.current = false;
    setLoadError(false);
    setUri(url);
    setWebKey(value => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    Linking.getInitialURL().then(url => { if (active && url) navigate(url); }).catch(() => {}).finally(() => { if (active) setInitialReady(true); });
    const deepLink = Linking.addEventListener('url', event => navigate(event.url));
    return () => { active = false; deepLink.remove(); };
  }, [navigate]);

  useEffect(() => {
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack.current && web.current && !loadError) { web.current.goBack(); return true; }
      return false;
    });
    return () => back.remove();
  }, [loadError]);

  const cameraPermission = async () => {
    if (cameraBusy.current) return;
    cameraBusy.current = true;
    let granted = false;
    try {
      if (Platform.OS === 'android') {
        const permission = PermissionsAndroid.PERMISSIONS.CAMERA;
        granted = await PermissionsAndroid.check(permission) || (await PermissionsAndroid.request(permission, {
          title: 'Take a photo for HDS Chat', message: 'Allow camera access to attach a new photo. You can still choose an existing image or file without it.', buttonPositive: 'Continue', buttonNegative: 'Not now',
        })) === PermissionsAndroid.RESULTS.GRANTED;
      }
      if (!granted) Alert.alert('Camera not enabled', 'Choose Photos or Document instead, or allow Camera in Android app settings.');
    } catch { Alert.alert('Camera unavailable', 'You can still attach an existing image or document.'); }
    finally {
      if (isTrustedUrl(currentUrl.current)) web.current?.injectJavaScript(`if (location.origin === ${JSON.stringify(APP_ORIGIN)}) window.__hdsNative?.onCameraPermission?.(${granted}); true;`);
      cameraBusy.current = false;
    }
  };

  const onMessage = (event: WebViewMessageEvent) => {
    if (!isTrustedUrl(currentUrl.current)) return;
    const message = parseBridgeMessage(event.nativeEvent.data, event.nativeEvent.url);
    if (!message) return;
    if (message.type === 'open') void openBrowser(message.url);
    if (message.type === 'camera:request') void cameraPermission();
    if (message.type === 'ready' || message.type === 'push:register') {
      web.current?.injectJavaScript(PUSH_UNAVAILABLE);
      // No Firebase config: never request push permission or send a fake token.
      if (message.type === 'push:register') setPushNotice(true);
    }
  };

  return <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
    <StatusBar style="dark" />
    {pushNotice && <View style={styles.notice} accessibilityRole="alert">
      <Text style={styles.noticeText}>Native notifications are not enabled in this preview. Open HDS Chat to check new messages.</Text>
      <Pressable accessibilityLabel="Dismiss notification notice" onPress={() => setPushNotice(false)} hitSlop={12}><Text style={styles.dismiss}>×</Text></Pressable>
    </View>}
    {!initialReady ? <View style={styles.center}><ActivityIndicator color="#ee1c25" /></View> : loadError ? <View style={styles.center}>
      <Text style={styles.heading}>Unable to load HDS Chat</Text>
      <Text style={styles.message}>Check your connection and try again. Your session has not been cleared.</Text>
      <Pressable style={styles.button} onPress={() => { setLoadError(false); setWebKey(value => value + 1); }}><Text style={styles.buttonText}>Try again</Text></Pressable>
    </View> : <WebView
      key={webKey}
      ref={web}
      source={{ uri }}
      style={styles.web}
      // '*' disables react-native-webview's implicit Linking.openURL fallback.
      // This is NOT the allowlist: native security plugin + callback enforce it.
      originWhitelist={['*']}
      onShouldStartLoadWithRequest={request => {
        const action = navigationAction(request.url);
        if (action === 'browser') void openBrowser(request.url);
        return action === 'webview';
      }}
      onOpenWindow={event => { if (isTrustedUrl(currentUrl.current)) void openBrowser(event.nativeEvent.targetUrl); }}
      onNavigationStateChange={state => {
        if (!isTrustedUrl(state.url)) { web.current?.stopLoading(); return; }
        currentUrl.current = state.url;
        canGoBack.current = state.canGoBack;
      }}
      onMessage={onMessage}
      injectedJavaScriptBeforeContentLoaded={BOOTSTRAP}
      injectedJavaScript={BOOTSTRAP}
      injectedJavaScriptBeforeContentLoadedForMainFrameOnly
      injectedJavaScriptForMainFrameOnly
      javaScriptEnabled
      domStorageEnabled
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      mixedContentMode="never"
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows
      mediaPlaybackRequiresUserAction
      geolocationEnabled={false}
      webviewDebuggingEnabled={false}
      allowsBackForwardNavigationGestures
      startInLoadingState
      renderLoading={() => <View style={styles.loading}><ActivityIndicator color="#ee1c25" /><Text style={styles.message}>Loading HDS Chat…</Text></View>}
      onError={() => setLoadError(true)}
      onHttpError={event => { if (isTrustedUrl(event.nativeEvent.url) && event.nativeEvent.url === currentUrl.current && event.nativeEvent.statusCode >= 400) setLoadError(true); }}
      onRenderProcessGone={() => setLoadError(true)}
      onFileDownload={event => { void openBrowser(event.nativeEvent.downloadUrl); }}
    />}
  </SafeAreaView>;
}

export default function App() { return <SafeAreaProvider><Shell /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#ffffff' }, web: { flex: 1, backgroundColor: '#ffffff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 28 },
  loading: { ...StyleSheet.absoluteFillObject, backgroundColor: '#ffffff', justifyContent: 'center', alignItems: 'center' },
  heading: { fontSize: 22, fontWeight: '700', color: '#17212b', marginBottom: 12 },
  message: { fontSize: 15, color: '#536471', textAlign: 'center', marginTop: 10 },
  button: { backgroundColor: '#ee1c25', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 13, marginTop: 22 },
  buttonText: { color: '#ffffff', fontWeight: '700', fontSize: 16 },
  notice: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: '#fff2d9', gap: 12 },
  noticeText: { flex: 1, fontSize: 12, color: '#614300' }, dismiss: { fontSize: 24, color: '#614300' },
});
