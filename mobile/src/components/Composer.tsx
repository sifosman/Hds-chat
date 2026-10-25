import React, { useEffect, useRef, useState } from 'react';
import { AppState, Modal, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as Location from 'expo-location';
import { send } from '../lib/chat';
import { compressImage, VoiceRecorder } from '../lib/media';
import { HoldToTalk, type HoldHooks, type VoiceSession } from '../lib/voicehold';
import { msgPreview } from '../lib/format';
import type { Msg } from '../lib/types';
import { useTheme, type Theme } from '../lib/theme';

const MAX_SIZE = 25 * 1024 * 1024;

export function Composer({ onError, replyTo, onClearReply, disabledActions }: { onError: (m: string) => void; replyTo: Msg | null; onClearReply: () => void; disabledActions?: boolean }) {
  const theme = useTheme();
  const s = styles(theme);
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [rec, setRec] = useState<{ s: VoiceSession; secs: number; level: number } | null>(null);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRec(r => (r ? { ...r, secs: Math.floor((Date.now() - r.s.startedAt) / 1000) } : r)), 250);
    return () => clearInterval(t);
  }, [!!rec]);

  const replyFields = () => replyTo ? { reply_to: replyTo.wa_id || replyTo.id, reply_preview: msgPreview(replyTo) } : {};

  // The hold controller reads hooks through a ref so a release always sends with the
  // latest reply context, and cancels land even if start() resolves post-release.
  const hooksRef = useRef<HoldHooks>(null as unknown as HoldHooks);
  hooksRef.current = {
    onRecording: s => {
      s.onLevel = level => setRec(r => (r ? { ...r, level } : r));
      setRec({ s, secs: 0, level: 0 });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    },
    onIdle: () => setRec(null),
    onSend: async (uri, mime) => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      await enqueue({ type: 'audio', uri, mime, filename: 'voice-note.m4a', ...replyFields() });
    },
    onError,
  };
  const holdRef = useRef<HoldToTalk>(null as unknown as HoldToTalk);
  if (!holdRef.current) holdRef.current = new HoldToTalk(() => new VoiceRecorder(), () => hooksRef.current);
  const hold = holdRef.current;

  // Unmount or background mid-hold cancels the recording; nothing is sent.
  useEffect(() => {
    const sub = AppState.addEventListener('change', st => { if (st !== 'active') hold.terminate(); });
    return () => { sub.remove(); hold.terminate(); };
  }, []);

  // Draft and reply are only cleared after the message is durably queued; a failed
  // enqueue keeps the composer contents so nothing is silently lost.
  const enqueuing = useRef(false);
  const enqueue = async (p: Parameters<typeof send>[0]) => {
    if (disabledActions) { onError('Preview only — nothing is sent.'); return; }
    if (enqueuing.current) return;
    enqueuing.current = true;
    try {
      await send(p);
      setText(''); onClearReply();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not send. Please try again.');
    } finally { enqueuing.current = false; }
  };

  const sendText = () => {
    const t = text.trim();
    if (!t || enqueuing.current) return;
    if (t.length > 4096) { onError('Please split your message or attach a document. Messages are limited to 4,096 characters.'); return; }
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    void enqueue({ type: 'text', body: t, ...replyFields() });
  };

  async function sendFile(uri: string, mime: string, filename: string, size: number, kind: 'image' | 'document') {
    try {
      if (size > MAX_SIZE) { onError(`${filename} is larger than 25 MB.`); return; }
      if (kind === 'image' && mime.startsWith('image/')) {
        const c = await compressImage(uri, mime, size);
        await enqueue({ type: 'image', uri: c.uri, mime: c.mime, filename: filename.replace(/\.\w+$/, '.jpg'), body: text.trim() || undefined, ...replyFields() });
      } else {
        await enqueue({ type: 'document', uri, mime: mime || 'application/octet-stream', filename, body: text.trim() || undefined, ...replyFields() });
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not attach that file. Please try again.');
    }
  }

  async function pickCamera() {
    setMenu(false);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { onError('Camera access is needed to take a photo. Choose Photos instead.'); return; }
      const r = await ImagePicker.launchCameraAsync({ quality: 0.85 });
      const a = r.assets?.[0];
      if (a) await sendFile(a.uri, a.mimeType || 'image/jpeg', a.fileName || 'photo.jpg', a.fileSize || 0, 'image');
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not take a photo. Please try again.'); }
  }
  async function pickPhotos() {
    setMenu(false);
    try {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 10, quality: 0.85 });
      for (const a of r.assets || []) await sendFile(a.uri, a.mimeType || 'image/jpeg', a.fileName || 'photo.jpg', a.fileSize || 0, 'image');
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not pick photos. Please try again.'); }
  }
  async function pickDocs() {
    setMenu(false);
    try {
      const r = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
      for (const a of r.assets || []) await sendFile(a.uri, a.mimeType || 'application/octet-stream', a.name, a.size || 0, 'document');
    } catch (e) { onError(e instanceof Error ? e.message : 'Could not pick documents. Please try again.'); }
  }
  async function shareLocation() {
    setMenu(false);
    const perm = await Location.requestForegroundPermissionsAsync().catch(() => null);
    if (!perm?.granted) { onError('Location access is needed to share your location.'); return; }
    try {
      const p = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
      await enqueue({ type: 'location', location: { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), name: 'My location' }, ...replyFields() });
    } catch { onError('Could not get your location. Please try again.'); }
  }

  // Hold-to-record with slide-left-to-cancel, WhatsApp style. The mic responder view
  // keeps the same position in the tree whether or not we are recording, so the
  // gesture is never interrupted by the recording UI appearing.
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => { if (!disabledActions) hold.press(); },
    onPanResponderRelease: (_e, g) => hold.release(g.dx < -70),
    onPanResponderTerminate: () => hold.terminate(),
  })).current;

  return (
    <View>
      {replyTo && (
        <View style={s.replyBar}>
          <View style={s.replyTick} />
          <View style={{ flex: 1 }}>
            <Text style={[s.replyName, { color: theme.red }]}>{replyTo.direction === 'in' ? 'You' : replyTo.sender === 'bot' ? 'William' : 'HDS'}</Text>
            <Text style={s.replyText} numberOfLines={1}>{msgPreview(replyTo)}</Text>
          </View>
          <Pressable onPress={onClearReply} hitSlop={10}><Ionicons name="close" size={20} color={theme.muted} /></Pressable>
        </View>
      )}
      <View style={s.composer}>
        {rec ? (
          <View style={s.recIndicator}>
            <View style={[s.recDot, { transform: [{ scale: 1 + rec.level * 2 }] }]} />
            <Text style={[s.recText, { color: theme.red }]}>{Math.floor(rec.secs / 60)}:{String(rec.secs % 60).padStart(2, '0')}</Text>
            <Text style={s.recHint}>◀ slide to cancel</Text>
          </View>
        ) : (
          <View style={s.pill}>
            <Pressable style={s.iconBtn} onPress={() => { if (disabledActions) onError('Preview only — nothing is sent.'); else setMenu(m => !m); }} accessibilityLabel="Attach"><Ionicons name="attach" size={24} color={theme.muted} /></Pressable>
            <TextInput
              style={s.input} value={text} onChangeText={setText} placeholder="Message" placeholderTextColor={theme.muted}
              multiline submitBehavior="newline"
            />
          </View>
        )}
        {text.trim() && !rec
          ? <Pressable style={[s.sendBtn, { backgroundColor: theme.red }]} onPress={sendText} accessibilityLabel="Send"><Ionicons name="send" size={20} color="#fff" /></Pressable>
          : <View {...pan.panHandlers} style={[s.sendBtn, { backgroundColor: theme.red }]} accessibilityLabel="Hold to record voice note"><Ionicons name="mic" size={22} color="#fff" /></View>}
      </View>

      <Modal visible={menu} transparent animationType="fade" onRequestClose={() => setMenu(false)}>
        <Pressable style={s.menuBackdrop} onPress={() => setMenu(false)}>
          <View style={s.attachMenu}>
            <AttachBtn icon="camera" color="#e3242b" label="Camera" onPress={pickCamera} theme={theme} />
            <AttachBtn icon="images" color="#9c27b0" label="Photos" onPress={pickPhotos} theme={theme} />
            <AttachBtn icon="document" color="#1b4f9c" label="Document" onPress={pickDocs} theme={theme} />
            <AttachBtn icon="location" color="#2e9d4a" label="Location" onPress={shareLocation} theme={theme} />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function AttachBtn({ icon, color, label, onPress, theme }: { icon: keyof typeof Ionicons.glyphMap; color: string; label: string; onPress: () => void; theme: Theme }) {
  return (
    <Pressable style={{ alignItems: 'center', gap: 6 }} onPress={onPress}>
      <View style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={24} color="#fff" />
      </View>
      <Text style={{ fontSize: 12.5, color: theme.ink }}>{label}</Text>
    </Pressable>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingHorizontal: 8, paddingTop: 5, paddingBottom: 7 },
  pill: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', backgroundColor: t.panel, borderRadius: 24, minHeight: 44, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 0.5, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  input: { flex: 1, paddingHorizontal: 4, paddingVertical: 11, fontSize: 16, lineHeight: 21, maxHeight: 120, color: t.ink, minWidth: 0 },
  iconBtn: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginBottom: 1 },
  sendBtn: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  recIndicator: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.panel, borderRadius: 22, paddingHorizontal: 14, minHeight: 44, shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 0.5, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: t.red },
  recText: { fontWeight: '500', fontSize: 14 },
  recHint: { flex: 1, textAlign: 'right', fontSize: 13, color: t.muted },
  replyBar: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: t.panel, borderRadius: 10, marginHorizontal: 8, marginTop: 6, padding: 8, borderLeftWidth: 0, overflow: 'hidden' },
  replyTick: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: t.red },
  replyName: { fontSize: 12.5, fontWeight: '700' },
  replyText: { fontSize: 13, color: t.muted },
  menuBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.3)', justifyContent: 'flex-end', paddingBottom: 90 },
  attachMenu: { flexDirection: 'row', justifyContent: 'space-evenly', backgroundColor: t.panel, borderRadius: 14, marginHorizontal: 8, paddingVertical: 14, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 4 }, elevation: 6 },
});
