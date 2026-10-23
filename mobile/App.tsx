import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Linking, PermissionsAndroid, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as WebBrowser from 'expo-web-browser';
import * as Notifications from 'expo-notifications';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { APP_ORIGIN, HOME_URL, appDeepLink, externalHttps, isTrustedUrl, navigationAction, parseBridgeMessage } from './src/security';
import { BOOTSTRAP, pushSyncScript, safeAreaScript, type NativePushStatus } from './src/injected';
import { initNotifications, pushPermissionStatus, registerPush } from './src/push';

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
  const [barStyle, setBarStyle] = useState<'light' | 'dark'>('light');
  const insets = useSafeAreaInsets();
  // The page pads itself via --safe-* CSS vars; the shell must not pad again.
  const safeScript = useMemo(() => safeAreaScript(insets), [insets.top, insets.bottom, insets.left, insets.right]);

  useEffect(() => { if (isTrustedUrl(currentUrl.current)) web.current?.injectJavaScript(safeScript); }, [safeScript]);

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

  const injectPush = useCallback((status: NativePushStatus, token?: string) => {
    if (isTrustedUrl(currentUrl.current)) web.current?.injectJavaScript(pushSyncScript(status, token));
  }, []);

  /** ready => report only (no OS prompt). push:register => ask, then get a token. */
  const syncPush = useCallback(async (allowPrompt: boolean) => {
    const status = await pushPermissionStatus();
    if (status === 'granted' || allowPrompt) {
      const result = await registerPush();
      injectPush(result.status, result.token);
      if (allowPrompt && result.status === 'unavailable') setPushNotice(true);
      return;
    }
    injectPush(status);
  }, [injectPush]);

  useEffect(() => {
    initNotifications();
    const openNotification = (data: Record<string, unknown> | undefined) => {
      const path = typeof data?.url === 'string' ? data.url : '/';
      navigate(path.startsWith('/') ? `${APP_ORIGIN}${path}` : path);
    };
    const tap = Notifications.addNotificationResponseReceivedListener(response => openNotification(response.notification.request.content.data as Record<string, unknown>));
    Notifications.getLastNotificationResponseAsync().then(response => { if (response) openNotification(response.notification.request.content.data as Record<string, unknown>); }).catch(() => {});
    void syncPush(false);
    return () => tap.remove();
  }, [navigate, syncPush]);

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
    if (message.type === 'chrome') setBarStyle(message.bar);
    if (message.type === 'ready') void syncPush(false);
    if (message.type === 'push:register') void syncPush(true);
  };

  return <View style={styles.root}>
    <StatusBar style={barStyle} />
    {pushNotice && <View style={styles.notice} accessibilityRole="alert">
      <Text style={styles.noticeText}>Notifications are not available on this device. Open HDS Chat to check new messages.</Text>
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
      injectedJavaScriptBeforeContentLoaded={safeScript + BOOTSTRAP}
      injectedJavaScript={safeScript + BOOTSTRAP}
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
  </View>;
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
