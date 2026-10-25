import React, { memo, useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { openExternal } from '../lib/api';
import { ChatImage } from './ChatImage';
import { RichText } from './RichText';
import { CAROUSEL_CARD_W, CAROUSEL_SNAP, carouselViewportWidth, singleImageWidth } from '../lib/bubblelayout';
import { time } from '../lib/format';
import type { Msg } from '../lib/types';
import { useTheme, type Theme } from '../lib/theme';
import { QuoteCard } from './QuoteSheet';

function Ticks({ m, theme }: { m: Msg; theme: Theme }) {
  if (m.direction !== 'in') return null;
  if (m.status === 'sending') return <Ionicons name="time-outline" size={14} color={theme.tick} />;
  if (m.status === 'failed') return <Ionicons name="alert-circle" size={14} color={theme.red} />;
  if (m.status === 'sent') return <Ionicons name="checkmark" size={15} color={theme.tick} />;
  return <Ionicons name="checkmark-done" size={16} color={m.status === 'read' ? theme.tickRead : theme.tick} />;
}

function Audio({ src, theme }: { src: string; theme: Theme }) {
  const player = useAudioPlayer(src);
  const st = useAudioPlayerStatus(player);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const pos = st.currentTime || 0, dur = st.duration || 0;
  return (
    <View style={audioStyles.voice}>
      <Pressable style={[audioStyles.btn, { backgroundColor: theme.red }]} accessibilityLabel={st.playing ? 'Pause' : 'Play'}
        onPress={() => { if (st.playing) player.pause(); else { if (dur && pos >= dur) player.seekTo(0); player.play(); } }}>
        <Ionicons name={st.playing ? 'pause' : 'play'} size={20} color="#fff" />
      </Pressable>
      <View style={[audioStyles.bar, { backgroundColor: theme.dark ? 'rgba(255,255,255,.15)' : 'rgba(0,0,0,.12)' }]}>
        <View style={[audioStyles.fill, { backgroundColor: theme.red, width: dur ? `${(pos / dur) * 100}%` : 0 }]} />
      </View>
      <Text style={[audioStyles.time, { color: theme.muted }]}>{fmt(st.playing || pos ? pos : dur)}</Text>
    </View>
  );
}
const audioStyles = StyleSheet.create({
  voice: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 210, paddingVertical: 2 },
  btn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  bar: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4 },
  time: { fontSize: 12, minWidth: 32 },
});

function Video({ src }: { src: string }) {
  const player = useVideoPlayer(src);
  return <VideoView player={player} style={{ width: 240, height: 300, borderRadius: 8 }} nativeControls contentFit="contain" />;
}

export interface BubbleProps {
  m: Msg; showName: boolean; isLast: boolean;
  onImage: (src: string) => void; onQuote: (ref: string) => void; onReply: (text: string) => void;
  onRetry: (m: Msg) => void; onDiscard: (m: Msg) => void; onLongPress: (m: Msg) => void;
  onExternal?: (url: string) => void;
}

export const Bubble = memo(function Bubble({ m, showName, isLast, onImage, onQuote, onReply, onRetry, onDiscard, onLongPress, onExternal }: BubbleProps) {
  const theme = useTheme();
  const s = useMemo(() => styles(theme), [theme]);
  const { width } = useWindowDimensions();
  const external = onExternal || openExternal;
  const mine = m.direction === 'in';
  const src = m.localUri || m.media_url || '';
  const p = m.payload || {};
  const name = m.sender === 'agent' ? (m.sender_name || 'HDS team') : m.sender === 'bot' ? 'William' : m.sender === 'system' ? 'HDS service' : '';
  const isHistory = p.channel === 'whatsapp';
  return (
    <View style={[s.row, mine ? s.rowMine : s.rowTheirs, showName && s.grp]}>
      <Pressable onLongPress={() => onLongPress(m)} delayLongPress={350} style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs, showName && (mine ? s.tailMine : s.tailTheirs), m.sender === 'agent' && s.agent, isHistory && s.history]}>
        {showName && !mine && (
          <View style={s.senderRow}>
            <Text style={[s.sender, m.sender === 'agent' && { color: theme.blue }]}>{name}</Text>
            {m.sender === 'agent' && <Text style={s.staffTag}>HDS team</Text>}
          </View>
        )}
        {!!p.reply_preview && (
          <View style={s.quoteBar}>
            <View style={s.quoteTick} />
            <Text style={s.quoteText} numberOfLines={2}>{p.reply_preview}</Text>
          </View>
        )}

        {m.type === 'image' && (
          <ChatImage uri={src} onPress={src ? () => onImage(src) : undefined} style={[s.mediaImg, { width: singleImageWidth(width) }]} w={singleImageWidth(width)} h={240} />
        )}
        {m.type === 'video' && !!src && <Video src={src} />}
        {m.type === 'audio' && !!src && <Audio src={src} theme={theme} />}
        {!!p.quote && <QuoteCard q={p.quote} theme={theme} onOpen={() => onQuote(p.quote.quote_number)} />}
        {m.type === 'document' && !p.quote && (
          <Pressable style={s.doc} onPress={() => src && external(src)}>
            <Ionicons name="document-text" size={26} color={theme.muted} /><Text style={s.docName} numberOfLines={1}>{p.filename || 'Document'}</Text>
          </Pressable>
        )}
        {m.type === 'location' && !!p.location && (
          <Pressable style={s.doc} onPress={() => external(`https://maps.google.com/?q=${p.location.lat},${p.location.lon}`)}>
            <Ionicons name="location" size={24} color={theme.green} /><Text style={s.docName} numberOfLines={1}>{p.location.name || 'Shared location'}</Text>
          </Pressable>
        )}
        {m.type === 'carousel' && !!m.body && <RichText text={m.body} theme={theme} style={[s.text, { marginBottom: 6 }]} onExternal={external} />}
        {m.type === 'carousel' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[s.carousel, { width: carouselViewportWidth(width) }]} contentContainerStyle={{ alignItems: 'flex-start' }} snapToInterval={CAROUSEL_SNAP} decelerationRate="fast">
            {(p.cards || []).map((c: any, i: number) => (
              <View key={i} style={s.card}>
                {!!c.image && <ChatImage uri={c.image} onPress={() => onImage(c.image)} style={s.cardImg} w={CAROUSEL_CARD_W - 2} h={150} />}
                {!!c.text && <RichText text={c.text} theme={theme} style={s.cardText} onExternal={external} />}
                {(c.buttons || []).map((b: any, j: number) => <Pressable key={j} style={s.cardBtn} onPress={() => external(b.url)}><Text style={s.cardBtnText}>{b.text}</Text></Pressable>)}
                {(c.quick_replies || []).map((t: string, j: number) => <Pressable key={'q' + j} style={s.cardBtn} onPress={() => onReply(t)}><Text style={s.cardBtnText}>{t}</Text></Pressable>)}
              </View>
            ))}
          </ScrollView>
        )}

        {!!m.body && m.type !== 'carousel' && <RichText text={m.body} theme={theme} style={s.text} onExternal={external} />}
        {!!p.footer && <Text style={s.footerText}>{p.footer}</Text>}

        {(p.pay_links || []).map((u: string) => <Pressable key={u} style={s.payBtn} onPress={() => external(u)}><Text style={s.payBtnText}>Pay now securely</Text></Pressable>)}
        {(p.buttons || []).map((b: any, i: number) => <Pressable key={i} style={s.linkBtn} onPress={() => external(b.url)}><Text style={s.linkBtnText}>{b.text}</Text></Pressable>)}
        {!p.quote && (p.quote_refs || []).length > 0 && (
          <View style={s.chips}>{p.quote_refs.map((r: string) => <Pressable key={r} style={s.chip} onPress={() => onQuote(r)}><Text style={s.chipText}>View quote {r.slice(0, 15)}</Text></Pressable>)}</View>
        )}

        <View style={s.meta}>
          {isHistory && <Text style={s.waTag}>WhatsApp</Text>}
          <Text style={s.metaText}>{time(m.created_at)}</Text>
          <Ticks m={m} theme={theme} />
        </View>
        {m.status === 'failed' && (
          <Text style={s.failedText}>{p.error ? `${p.error} ` : 'Not sent. '}<Text style={s.failedLink} onPress={() => onRetry(m)}>Retry</Text> · <Text style={s.failedLink} onPress={() => onDiscard(m)}>Delete</Text></Text>
        )}
      </Pressable>
      {isLast && !mine && (p.quick_replies || []).length > 0 && (
        <View style={s.quick}>{p.quick_replies.map((t: string) => <Pressable key={t} style={s.chip} onPress={() => onReply(t)}><Text style={s.chipText}>{t}</Text></Pressable>)}</View>
      )}
    </View>
  );
});

const styles = (t: Theme) => StyleSheet.create({
  row: { marginVertical: 2, paddingHorizontal: 10, alignItems: 'flex-start' },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  grp: { marginTop: 8 },
  history: { opacity: 0.88 },
  bubble: {
    maxWidth: '82%', paddingHorizontal: 9, paddingTop: 6, paddingBottom: 4, borderRadius: 12,
    shadowColor: '#000', shadowOpacity: 0.13, shadowRadius: 0.5, shadowOffset: { width: 0, height: 1 }, elevation: 1,
  },
  bubbleMine: { backgroundColor: t.mine },
  bubbleTheirs: { backgroundColor: t.theirs },
  tailMine: { borderTopRightRadius: 3 },
  tailTheirs: { borderTopLeftRadius: 3 },
  agent: { borderLeftWidth: 3, borderLeftColor: '#1b4f9c' },
  senderRow: { flexDirection: 'row', gap: 6, alignItems: 'center', marginBottom: 2 },
  sender: { fontSize: 12.5, fontWeight: '600', color: t.red },
  staffTag: { fontWeight: '500', fontSize: 10.5, backgroundColor: '#e8eefb', color: '#1b4f9c', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, overflow: 'hidden' },
  quoteBar: { flexDirection: 'row', backgroundColor: t.dark ? 'rgba(255,255,255,.07)' : 'rgba(0,0,0,.05)', borderRadius: 6, marginBottom: 4, overflow: 'hidden' },
  quoteTick: { width: 3, backgroundColor: t.red },
  quoteText: { flex: 1, fontSize: 12.5, color: t.muted, paddingHorizontal: 8, paddingVertical: 5, fontStyle: 'italic' },
  mediaImg: { borderRadius: 8, marginBottom: 4, height: 240 },
  doc: { flexDirection: 'row', gap: 10, alignItems: 'center', backgroundColor: t.dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.04)', borderRadius: 8, padding: 10, marginBottom: 4, minWidth: 190 },
  docName: { fontSize: 14, color: t.ink, flex: 1 },
  carousel: { marginVertical: 2, flexGrow: 0, flexShrink: 0 },
  card: { width: CAROUSEL_CARD_W, backgroundColor: t.panel, borderWidth: 1, borderColor: t.line, borderRadius: 12, overflow: 'hidden', marginRight: 8 },
  cardImg: { width: '100%', height: 150 },
  cardText: { paddingHorizontal: 8, paddingVertical: 6, fontSize: 13.5, color: t.ink },
  cardBtn: { borderTopWidth: 1, borderTopColor: t.line, padding: 8 },
  cardBtnText: { color: t.blue, fontWeight: '500', fontSize: 13.5, textAlign: 'center' },
  text: { fontSize: 15, lineHeight: 21, color: t.ink },
  footerText: { fontSize: 12.5, color: t.muted, marginTop: 3 },
  payBtn: { marginTop: 6, borderRadius: 8, padding: 10, backgroundColor: t.red },
  payBtnText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  linkBtn: { marginTop: 6, borderWidth: 1, borderColor: t.line, borderRadius: 8, padding: 8, backgroundColor: t.panel },
  linkBtnText: { color: t.blue, fontWeight: '500', textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
  chip: { borderWidth: 1, borderColor: t.chipBorder, backgroundColor: t.panel, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  chipText: { color: t.redD, fontSize: 13.5 },
  quick: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, maxWidth: '90%' },
  meta: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 3, marginTop: 2 },
  metaText: { fontSize: 11, color: t.muted },
  waTag: { backgroundColor: '#e7f8ee', color: '#128c4a', borderRadius: 5, paddingHorizontal: 4, fontSize: 10, overflow: 'hidden', marginRight: 4 },
  failedText: { fontSize: 12.5, color: t.red, marginTop: 2 },
  failedLink: { color: t.blue, textDecorationLine: 'underline' },
});
