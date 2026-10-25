import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Linking, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import * as Font from 'expo-font';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { inviteToken } from './src/security';
import { api, auth, setLogoutHandler } from './src/lib/api';
import { restoreSession } from './src/lib/boot';
import { send, start, stop } from './src/lib/chat';
import { cachedUser, cacheUser, wipeLocal } from './src/lib/localdb';
import { clearOutboxMedia } from './src/lib/outboxstore';
import * as FileSystem from 'expo-file-system/legacy';
import { initNotifications, refreshPush } from './src/lib/push';
import { jostFamily, launchRoute, parsePreviewUrl } from './src/lib/entrance';
import type { Me } from './src/lib/types';
import { SignedInTabs } from './src/components/SignedInTabs';
import { Account } from './src/screens/Account';
import { Chat } from './src/screens/Chat';
import { Invite } from './src/screens/Invite';
import { Login } from './src/screens/Login';
import { Quotes } from './src/screens/Quotes';
import { EntrancePreview } from './src/dev/EntrancePreview';

void SplashScreen.preventAutoHideAsync().catch(() => {});

const navRef = createNavigationContainerRef();
const inviteFromUrl = (url: string | null) => (url ? inviteToken(url) : null);
// __DEV__ entrance preview: hds-chat://dev-preview?state=NAME renders synthetic,
// fully inert auth/invite states for screenshots — never reaches production.
const previewFromUrl = (url: string | null) =>
  __DEV__ && url ? parsePreviewUrl(url) : null;
function Shell() {
  const [me, setMe] = useState<Me | null>(null);
  const [boot, setBoot] = useState(true);
  const [invite, setInvite] = useState<string | null>(null);
  const [urlResolved, setUrlResolved] = useState(false);
  const [jostLoaded, setJostLoaded] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);

  const generation = useRef(0);
  const cleanup = useRef<Promise<void>>(Promise.resolve());
  const clearSession = useCallback(() => {
    ++generation.current;
    stop(); setMe(null); setBoot(false);
    cleanup.current = cleanup.current.catch(() => {}).then(async () => { await wipeLocal(); await clearOutboxMedia(FileSystem); });
    void cleanup.current.catch(() => {});
  }, []);
  useEffect(() => setLogoutHandler(clearSession), [clearSession]);

  useEffect(() => {
    const epoch = ++generation.current;
    let active = true;
    const alive = () => active && generation.current === epoch;
    void restoreSession(
      { auth, cachedUser, fetchMe: () => api<{ user: Me }>('/me').then(r => r.user), cacheUser },
      alive,
      setMe,
      () => setBoot(false),
    );
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!me) return;
    void start(me).catch(() => {});
    void refreshPush().catch(() => {});
    return () => stop();
  }, [me?.id]);

  // Deep links: verified HTTPS app links + hds-chat:// scheme both land here.
  // A warm link event bumps the epoch so a late-resolving getInitialURL can
  // never overwrite a newer invite.
  const linkEpoch = useRef(0);
  useEffect(() => {
    let active = true;
    const epoch = linkEpoch.current;
    const applyPreview = (url: string | null) => {
      if (!__DEV__) return;
      const p = previewFromUrl(url);
      if (p === 'off') setPreview(null); else if (active && p) setPreview(p);
    };
    Linking.getInitialURL().then(url => {
      const t = inviteFromUrl(url); if (active && t && linkEpoch.current === epoch) setInvite(t);
      if (active) applyPreview(url);
    }).catch(() => {}).finally(() => { if (active) setUrlResolved(true); });
    const sub = Linking.addEventListener('url', e => {
      const t = inviteFromUrl(e.url); if (t) { ++linkEpoch.current; setInvite(t); }
      applyPreview(e.url);
    });
    return () => { active = false; sub.remove(); };
  }, []);

  // Bundled Jost loads asynchronously in the background; entrance text falls
  // back to the platform face if it fails.
  useEffect(() => {
    let active = true;
    Font.loadAsync({ [jostFamily]: require('./assets/fonts/Jost.ttf') })
      .then(() => { if (active) setJostLoaded(true); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  // Hide the native splash once a drawable entrance frame is laid out — never
  // behind remote API work.
  const splashHidden = useRef(false);
  const onFirstLayout = useCallback(() => {
    if (splashHidden.current) return;
    splashHidden.current = true;
    requestAnimationFrame(() => void SplashScreen.hideAsync().catch(() => {}));
  }, []);

  // Notification taps route to the chat tab.
  useEffect(() => {
    initNotifications();
    const open = (data: Record<string, unknown> | undefined) => { if (navRef.isReady()) navRef.navigate('Chat' as never); };
    const tap = Notifications.addNotificationResponseReceivedListener(r => open(r.notification.request.content.data as Record<string, unknown>));
    Notifications.getLastNotificationResponseAsync().then(r => { if (r) open(r.notification.request.content.data as Record<string, unknown>); }).catch(() => {});
    return () => tap.remove();
  }, []);

  const signedIn = async (u: Me) => {
    const epoch = ++generation.current;
    const token = auth.token;
    stop(); setMe(null);
    if (!token) return;
    const valid = () => generation.current === epoch && auth.token === token;
    await cleanup.current.catch(() => {});
    if (!valid()) return;
    cleanup.current = wipeLocal().then(() => clearOutboxMedia(FileSystem));
    await cleanup.current;
    if (!valid()) return;
    await cacheUser(token, u, valid);
    if (!valid()) return;
    setInvite(null); setMe(u); setBoot(false);
  };
  const logout = async (all: boolean) => {
    void api('/auth/logout', { method: 'POST', body: { all } }).catch(() => {});
    auth.clear(); clearSession();
    await cleanup.current.catch(() => {});
  };
  const ask = (t: string) => { if (navRef.isReady()) navRef.navigate('Chat' as never); void send({ type: 'text', body: t }).catch(() => {}); };

  if (__DEV__ && preview) {
    return <View style={{ flex: 1 }} onLayout={onFirstLayout}><StatusBar style="light" /><EntrancePreview state={preview} jostLoaded={jostLoaded} /></View>;
  }

  // The entrance hero is a dark photo and the signed-in header is red — light
  // status-bar icons throughout.
  const bar = <StatusBar style="light" />;
  const route = launchRoute({ bootDone: !boot, signedIn: !!me, initialUrlResolved: urlResolved, invite: !!invite });
  if (route === 'invite') return <View style={{ flex: 1 }} onLayout={onFirstLayout}>{bar}<Invite token={invite!} onDone={signedIn} onFallback={() => setInvite(null)} jostLoaded={jostLoaded} /></View>;
  if (route === 'boot') return <View style={[s.splash, { backgroundColor: '#000' }]} onLayout={onFirstLayout}>{bar}<Image source={require('./assets/icon.png')} style={s.splashIcon} /></View>;
  if (route !== 'app') return (
    <View style={{ flex: 1 }} onLayout={onFirstLayout}>{bar}
      <Login onDone={signedIn} jostLoaded={jostLoaded} />
    </View>
  );

  // Logged-in screens have the red header (light icons); auth screens follow the theme.
  return (
    <View style={{ flex: 1 }} onLayout={onFirstLayout}>{bar}
    <NavigationContainer ref={navRef} key={`${me!.id}:${generation.current}`}>
      <SignedInTabs
        chat={<Chat onAskTab={ask} />}
        quotes={<Quotes onAsk={ask} />}
        account={<Account me={me!} onLogout={logout} onAsk={ask} />}
      />
    </NavigationContainer></View>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Shell />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

const s = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  splashIcon: { width: 96, height: 96, borderRadius: 22 },
});
