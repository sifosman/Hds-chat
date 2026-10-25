import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { FlatList, Image, Keyboard, KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Bubble } from '../components/Bubble';
import { Composer } from '../components/Composer';
import { Header } from '../components/Header';
import { NotifyCard } from '../components/NotifyCard';
import { QuoteSheet } from '../components/QuoteSheet';
import { chat, discard, loadHistory, loadOlder, retry, send } from '../lib/chat';
import { seamActions } from '../lib/preview';
import { openExternal } from '../lib/api';
import { pushPermissionStatus, setChatVisible } from '../lib/push';
import type { NativePushStatus } from '../lib/push';
import { dayLabel, msgPreview } from '../lib/format';
import type { Msg } from '../lib/types';
import { useTheme, type Theme } from '../lib/theme';

type Item =
  | { key: string; kind: 'msg'; m: Msg; showName: boolean; sep?: string; appStart?: boolean }
  | { key: string; kind: 'typing' };

function SwipeRow({ children, onReply }: { children: React.ReactNode; onReply: () => void }) {
  const dx = useSharedValue(0);
  const fired = useSharedValue(false);
  // Gesture callbacks run on the UI thread — JS callbacks must be bounced via runOnJS.
  const pan = Gesture.Pan()
    .activeOffsetX(18).failOffsetY([-8, 8])
    .onUpdate(e => { dx.value = Math.max(0, Math.min(90, e.translationX)); if (dx.value > 64 && !fired.value) { fired.value = true; } })
    .onFinalize((_e, success) => {
      const did = success && fired.value;
      fired.value = false;
      dx.value = withSpring(0);
      if (did) runOnJS(onReply)();
    });
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));
  return <GestureDetector gesture={pan}><Animated.View style={style}>{children}</Animated.View></GestureDetector>;
}

export function Chat({ onAskTab, preview }: { onAskTab?: (t: string) => void; preview?: { messages: Msg[] } }) {
  const theme = useTheme();
  const store = useSyncExternalStore(chat.subscribe, chat.get);
  const s = preview
    ? { me: null, messages: preview.messages, history: [], historyMore: false, historyLoading: false, historySettled: true, historyError: null, typingUntil: 0, online: true, connected: true, loaded: true }
    : store;
  const st = useMemo(() => styles(theme), [theme]);
  const insets = useSafeAreaInsets();
  const list = useRef<FlatList<Item>>(null);
  const stick = useRef(true);
  const snapPending = useRef(false);
  const loadingOlder = useRef(false);
  const [viewer, setViewer] = useState<string | null>(null);
  const [quoteRef, setQuoteRef] = useState<string | null>(null);
  const [menuMsg, setMenuMsg] = useState<Msg | null>(null);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [toast, setToast] = useState('');
  const [fab, setFab] = useState(false);
  const [push, setPush] = useState<NativePushStatus | null>(null);
  const [, tick] = useState(0);
  const typing = s.typingUntil > Date.now();

  useEffect(() => { if (!typing) return; const t = setTimeout(() => tick(x => x + 1), s.typingUntil - Date.now() + 50); return () => clearTimeout(t); }, [s.typingUntil, typing]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);
  useEffect(() => { if (!preview) pushPermissionStatus().then(setPush).catch(() => {}); }, []);
  useFocusEffect(useCallback(() => {
    setChatVisible(true);
    return () => setChatVisible(false);
  }, []));
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidShow', () => {
      if (stick.current) list.current?.scrollToOffset({ offset: 0, animated: true });
    });
    return () => sub.remove();
  }, []);

  const all: Msg[] = useMemo(() => [...s.history, ...s.messages], [s.history, s.messages]);
  const lastTheirs = useMemo(() => [...s.messages].reverse().find(m => m.direction === 'out'), [s.messages]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (typing) out.push({ key: 'typing', kind: 'typing' });
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i], prev = all[i - 1];
      const sep = !prev || dayLabel(prev.created_at) !== dayLabel(m.created_at) ? dayLabel(m.created_at) : undefined;
      const appStart = prev?.payload?.channel === 'whatsapp' && m.payload?.channel !== 'whatsapp';
      const showName = !prev || prev.direction !== m.direction || prev.sender !== m.sender || !!sep;
      out.push({ key: m.id, kind: 'msg', m, showName, sep, appStart });
    }
    return out;
  }, [all, typing]);

  const onScroll = useCallback((e: any) => {
    const off = e.nativeEvent.contentOffset.y;
    stick.current = off < 120;
    setFab(off > 500);
  }, []);

  // The newest item sits at index 0 of the inverted list, and
  // maintainVisibleContentPosition anchors the previously visible row when an
  // item is inserted before it — so new messages need an explicit scroll to be
  // revealed. Own sends always snap to the bottom; incoming ones only when the
  // user is already near it. The anchor compensation lands in the same layout
  // pass, so the snap is re-asserted from onContentSizeChange.
  const headKey = items.length ? items[0].key : '';
  const prevHead = useRef('');
  useEffect(() => {
    if (!headKey || headKey === prevHead.current) return;
    const first = !prevHead.current;
    prevHead.current = headKey;
    const own = items[0].kind === 'msg' && items[0].m.direction === 'in';
    if (!first && !own && !stick.current) return;
    snapPending.current = true;
    list.current?.scrollToOffset({ offset: 0, animated: !first });
  }, [headKey]);
  const onContentSizeChange = useCallback(() => {
    if (snapPending.current) {
      snapPending.current = false;
      list.current?.scrollToOffset({ offset: 0, animated: true });
    } else if (stick.current) {
      list.current?.scrollToOffset({ offset: 0, animated: false });
    }
  }, []);
  const onEndReached = useCallback(async () => {
    if (loadingOlder.current || preview) return;
    loadingOlder.current = true;
    const n = await loadOlder().catch(() => 0);
    if (!n && s.historyMore && s.historySettled) await loadHistory().catch(() => {});
    loadingOlder.current = false;
  }, [preview, s.historyMore, s.historySettled]);

  const ax = useMemo(() => seamActions(!!preview, {
    send: p => send(p as Parameters<typeof send>[0]),
    retry: m => { void retry(m as Msg); },
    discard: m => { void discard(m as Msg); },
    quote: setQuoteRef,
    external: openExternal,
  }, setToast), [preview]);

  const reply = useCallback((t: string) => { stick.current = true; void ax.send({ type: 'interactive', body: t }).catch(e => setToast(e.message)); }, [ax]);
  const ask = (t: string) => { stick.current = true; void ax.send({ type: 'text', body: t }).catch(e => setToast(e.message)); };
  const onLongPress = useCallback((mm: Msg) => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setMenuMsg(mm); }, []);
  const askOrNav = (t: string) => { if (onAskTab) onAskTab(t); else ask(t); };

  const longPressActions = (m: Msg) => {
    const acts: { label: string; onPress: () => void }[] = [];
    acts.push({ label: 'Reply', onPress: () => { setReplyTo(m); setMenuMsg(null); } });
    if (m.body) acts.push({ label: 'Copy', onPress: () => { void Clipboard.setStringAsync(m.body || ''); setMenuMsg(null); } });
    if (m.status === 'failed') {
      acts.push({ label: 'Retry', onPress: () => { ax.retry(m); setMenuMsg(null); } });
      acts.push({ label: 'Delete', onPress: () => { ax.discard(m); setMenuMsg(null); } });
    }
    return acts;
  };

  const sub = !s.online ? 'Waiting for network…' : typing ? 'typing…' : 'HDS sales assistant · replies 24/7';

  const renderItem = useCallback(({ item }: { item: Item }) => {
    if (item.kind === 'typing') {
      return (
        <View style={[st.row, { alignItems: 'flex-start', paddingHorizontal: 10 }]}>
          <View style={[st.typingBubble, { backgroundColor: theme.theirs }]}><View style={st.dots}><View style={st.dot} /><View style={[st.dot, st.dot2]} /><View style={[st.dot, st.dot3]} /></View></View>
        </View>
      );
    }
    const m = item.m;
    return (
      <View>
        {!!item.sep && <View style={st.dayWrap}><Text style={[st.day, { backgroundColor: theme.dayBg, color: theme.dayInk }]}>{item.sep}</Text></View>}
        {item.appStart && <View style={st.dayWrap}><Text style={[st.day, { backgroundColor: theme.appStartBg, color: theme.appStartInk }]}>Continued in the HDS app</Text></View>}
        {/* Carousels scroll horizontally themselves — a row swipe would steal the gesture. */}
        {m.type === 'carousel' ? (
          <Bubble m={m} showName={item.showName} isLast={m === lastTheirs}
            onImage={setViewer} onQuote={ax.quote} onReply={reply} onRetry={ax.retry} onDiscard={ax.discard} onExternal={ax.external} onLongPress={onLongPress} />
        ) : (
          <SwipeRow onReply={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); setReplyTo(m); }}>
            <Bubble m={m} showName={item.showName} isLast={m === lastTheirs}
              onImage={setViewer} onQuote={ax.quote} onReply={reply} onRetry={ax.retry} onDiscard={ax.discard} onExternal={ax.external} onLongPress={onLongPress} />
          </SwipeRow>
        )}
      </View>
    );
  }, [st, theme, lastTheirs, ax, reply, onLongPress]);

  return (
    <View style={[st.root, { backgroundColor: theme.bg }]}>
      <KeyboardAvoidingView style={st.kav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
      <Header title="William · HDS" sub={sub} />
      <FlatList<Item>
        ref={list}
        style={st.list}
        inverted
        data={items}
        keyboardShouldPersistTaps="handled"
        keyExtractor={i => i.key}
        onScroll={onScroll}
        onContentSizeChange={onContentSizeChange}
        scrollEventThrottle={80}
        onEndReachedThreshold={0.2}
        onEndReached={() => void onEndReached()}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        contentContainerStyle={{ paddingVertical: 8 }}
        keyboardDismissMode="interactive"
        removeClippedSubviews={false}
        initialNumToRender={16}
        maxToRenderPerBatch={12}
        updateCellsBatchingPeriod={32}
        windowSize={15}
        overScrollMode="never"
        renderItem={renderItem}
        ListFooterComponent={
          <View>
            <View style={st.historyCta}>
              {s.historyLoading ? (
                <Text style={st.muted}>Loading WhatsApp history…</Text>
              ) : s.historyError ? (
                <Pressable onPress={() => loadHistory(true).catch(() => {})}><Text style={[st.link, { color: theme.blue }]}>Couldn't load WhatsApp history — tap to retry</Text></Pressable>
              ) : s.historyMore && s.historySettled ? (
                <Pressable onPress={() => loadHistory().catch(e => setToast(e.message))}><Text style={[st.link, { color: theme.blue }]}>Load more WhatsApp history</Text></Pressable>
              ) : s.history.length ? <Text style={st.muted}>Start of your WhatsApp history</Text> : s.historySettled ? <Text style={st.muted}>No earlier WhatsApp messages</Text> : null}
            </View>
            {ax.showNotify && s.messages.some(m => m.direction === 'out') && <NotifyCard status={push} onDone={setPush} />}
            {s.loaded && s.historySettled && s.messages.length === 0 && s.history.length === 0 && (
              <View style={[st.welcome, { backgroundColor: theme.panel }]}>
                <Text style={[st.welcomeTitle, { color: theme.ink }]}>Hi{s.me?.name ? ' ' + s.me.name.split(' ')[0] : ''} 👋</Text>
                <Text style={[st.welcomeText, { color: theme.ink }]}>This is your direct line to HDS. William can quote you from a cutting list (type it, send a photo or a document), find your nearest branch, send product pictures and take payments, any time.</Text>
                <View style={st.chips}>
                  {['I need a quote', 'Find my nearest branch', 'Show me board colours', 'Check my payment'].map(t => (
                    <Pressable key={t} style={[st.chip, { borderColor: theme.chipBorder, backgroundColor: theme.panel }]} onPress={() => ask(t)}><Text style={[st.chipText, { color: theme.redD }]}>{t}</Text></Pressable>
                  ))}
                </View>
              </View>
            )}
          </View>
        }
      />
      {fab && (
        <Pressable style={[st.fab, { backgroundColor: theme.panel, bottom: 84 }]} onPress={() => list.current?.scrollToOffset({ offset: 0, animated: true })} accessibilityLabel="Scroll to latest">
          <Ionicons name="arrow-down" size={20} color={theme.muted} />
        </Pressable>
      )}
      {!!toast && <View style={[st.toast, { bottom: 74 }]}><Text style={st.toastText}>{toast}</Text></View>}
      <Composer onError={setToast} replyTo={replyTo} onClearReply={() => setReplyTo(null)} disabledActions={ax.disabledActions} />
      </KeyboardAvoidingView>

      <Modal visible={!!viewer} transparent onRequestClose={() => setViewer(null)}>
        <Pressable style={st.viewer} onPress={() => setViewer(null)}>
          {!!viewer && <Image source={{ uri: viewer }} style={st.viewerImg} resizeMode="contain" />}
        </Pressable>
      </Modal>

      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable style={st.menuBackdrop} onPress={() => setMenuMsg(null)}>
          <View style={[st.menu, { backgroundColor: theme.panel, marginBottom: 40 + insets.bottom }]}>
            {!!menuMsg && <Text style={[st.menuMsg, { color: theme.muted }]} numberOfLines={2}>{msgPreview(menuMsg)}</Text>}
            {menuMsg && longPressActions(menuMsg).map(a => (
              <Pressable key={a.label} style={st.menuItem} onPress={() => { void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); a.onPress(); }}>
                <Text style={[st.menuItemText, { color: a.label === 'Delete' ? theme.red : theme.ink }]}>{a.label}</Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>

      {!!quoteRef && <QuoteSheet refId={quoteRef} onClose={() => setQuoteRef(null)} onAsk={askOrNav} />}
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  root: { flex: 1 },
  kav: { flex: 1 },
  list: { flex: 1 },
  row: { marginVertical: 2 },
  typingBubble: { borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: t.tick },
  dot2: { opacity: 0.7 },
  dot3: { opacity: 0.4 },
  dayWrap: { alignItems: 'center', marginVertical: 10 },
  day: { fontSize: 12, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8, overflow: 'hidden' },
  historyCta: { alignItems: 'center', paddingVertical: 8 },
  link: { fontSize: 14, padding: 4 },
  muted: { color: t.muted, fontSize: 13 },
  welcome: { borderRadius: 12, padding: 14, margin: 10, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 0.5, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  welcomeTitle: { fontSize: 18, fontWeight: '700', marginBottom: 4 },
  welcomeText: { fontSize: 14.5, lineHeight: 20, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  chipText: { fontSize: 13.5 },
  fab: { position: 'absolute', right: 14, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 5 },
  toast: { position: 'absolute', left: 12, right: 12, backgroundColor: '#323232', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10, zIndex: 5 },
  toastText: { color: '#fff', fontSize: 14 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,.92)', alignItems: 'center', justifyContent: 'center' },
  viewerImg: { width: '100%', height: '100%' },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.4)', justifyContent: 'flex-end' },
  menu: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8, paddingHorizontal: 8 },
  menuMsg: { fontSize: 13, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.line, fontStyle: 'italic' },
  menuItem: { paddingHorizontal: 12, paddingVertical: 14 },
  menuItemText: { fontSize: 16 },
});
