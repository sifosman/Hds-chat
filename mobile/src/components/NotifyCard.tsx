import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { enablePush } from '../lib/push';
import type { NativePushStatus } from '../lib/push';
import { useTheme, type Theme } from '../lib/theme';

/** Inline chat card: the app equivalent of the web SetupCard — only the
 *  notifications step applies natively (the app is already installed). */
export function NotifyCard({ status, onDone }: { status: NativePushStatus | null; onDone: (s: NativePushStatus) => void }) {
  const theme = useTheme();
  const s = styles(theme);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  if (status !== 'default' || dismissed) return null;
  return (
    <View style={s.setup}>
      <Pressable style={s.x} onPress={() => setDismissed(true)} accessibilityLabel="Dismiss"><Ionicons name="close" size={16} color={theme.muted} /></Pressable>
      <Text style={s.title}>Get the most out of HDS chat</Text>
      <View style={s.step}>
        <Ionicons name="notifications-outline" size={22} color={theme.red} />
        <View style={{ flex: 1 }}>
          <Text style={s.stepTitle}>App-only specials & promos</Text>
          <Text style={s.stepText}>Deals land here first — plus you'll know the moment William sends your quote or the team replies.</Text>
          <Pressable style={[s.btn, busy && { opacity: 0.6 }]} disabled={busy}
            onPress={async () => { setBusy(true); try { onDone(await enablePush()); } finally { setBusy(false); } }}>
            <Text style={s.btnText}>Turn on notifications</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  setup: { backgroundColor: t.panel, borderWidth: 1, borderColor: t.line, borderRadius: 12, padding: 12, margin: 10 },
  x: { position: 'absolute', right: 8, top: 8, zIndex: 2, padding: 4 },
  title: { fontWeight: '700', marginBottom: 8, paddingRight: 24, color: t.ink },
  step: { flexDirection: 'row', gap: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: t.line },
  stepTitle: { fontWeight: '700', color: t.ink },
  stepText: { marginVertical: 4, fontSize: 13.5, color: t.muted },
  btn: { backgroundColor: t.red, borderRadius: 10, padding: 10, alignItems: 'center', marginTop: 6 },
  btnText: { color: '#fff', fontWeight: '700' },
});
