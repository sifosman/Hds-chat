import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Header } from '../components/Header';
import { api } from '../lib/api';
import { enablePush, pushPermissionStatus } from '../lib/push';
import type { NativePushStatus } from '../lib/push';
import type { Me } from '../lib/types';
import { useTheme, type Theme } from '../lib/theme';

export function Account({ me, onLogout, onAsk }: { me: Me; onLogout: (all: boolean) => void; onAsk: (t: string) => void }) {
  const theme = useTheme();
  const s = styles(theme);
  const [name, setName] = useState(me.name || '');
  const [saved, setSaved] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const [push, setPush] = useState<NativePushStatus | null>(null);
  const load = () => api('/sessions').then(r => setSessions(r.sessions)).catch(() => {});
  useEffect(() => { load(); }, []);
  useEffect(() => { pushPermissionStatus().then(setPush).catch(() => {}); }, []);

  return (
    <View style={[s.root, { backgroundColor: theme.panel }]}>
      <Header title="Account" sub="HDS Cut & Edge" />
      <ScrollView contentContainerStyle={{ padding: 14, paddingBottom: 40 }}>
        <Text style={s.h2}>Your details</Text>
        <Text style={s.label}>Name</Text>
        <View style={s.rowForm}>
          <TextInput style={[s.input, { borderColor: theme.line, backgroundColor: theme.panel, color: theme.ink }]} value={name} onChangeText={v => { setName(v); setSaved(false); }} />
          <Pressable style={[s.btn, !name.trim() && { opacity: 0.55 }]} disabled={!name.trim()}
            onPress={async () => { await api('/me', { method: 'PATCH', body: { name } }); setSaved(true); }}>
            <Text style={s.btnText}>{saved ? 'Saved ✓' : 'Save'}</Text>
          </Pressable>
        </View>
        <Text style={s.muted}>Cellphone: +{me.phone}</Text>

        <Text style={s.h2}>App & notifications</Text>
        {push === 'default' ? (
          <View style={[s.card, { borderColor: theme.line }]}>
            <View style={s.step}>
              <Ionicons name="notifications-outline" size={22} color={theme.red} />
              <View style={{ flex: 1 }}>
                <Text style={s.stepTitle}>App-only specials & promos</Text>
                <Text style={s.stepText}>Know the moment William sends your quote or the team replies.</Text>
                <Pressable style={[s.btn, { backgroundColor: theme.red, borderColor: theme.red }]} onPress={async () => setPush(await enablePush())}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Turn on notifications</Text>
                </Pressable>
              </View>
            </View>
          </View>
        ) : (
          <Text style={s.muted}>{push === 'granted' ? 'Notifications are on for this device ✓' : push === 'denied' ? 'Notifications are blocked in device settings. You can enable them there.' : 'Notifications are not available on this device.'}</Text>
        )}

        <Text style={s.h2}>Help</Text>
        <View style={s.chips}>
          <Pressable style={[s.chip, { borderColor: theme.chipBorder }]} onPress={() => onAsk('I would like to speak to a person please')}><Text style={[s.chipText, { color: theme.redD }]}>Talk to a person</Text></Pressable>
          <Pressable style={[s.chip, { borderColor: theme.chipBorder }]} onPress={() => onAsk('Which branch is nearest to me?')}><Text style={[s.chipText, { color: theme.redD }]}>Nearest branch</Text></Pressable>
        </View>

        <Text style={s.h2}>Devices</Text>
        {sessions.map(ses => (
          <View key={ses.id} style={[s.session, { borderBottomColor: theme.line }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: theme.ink, fontWeight: '600' }}>{ses.platform === 'android-app' ? 'Android app' : ses.platform === 'web' ? 'Browser' : ses.platform}
                {ses.current && <Text style={s.thisDevice}>  This device</Text>}
              </Text>
              <Text style={s.muted}>{(ses.device_label || '').slice(0, 40)} · last used {new Date(ses.last_used_at).toLocaleDateString('en-ZA')}</Text>
            </View>
            {!ses.current && <Pressable onPress={async () => { await api('/sessions/' + ses.id, { method: 'DELETE' }); load(); }}><Text style={{ color: theme.blue }}>Sign out</Text></Pressable>}
          </View>
        ))}
        <View style={s.actions}>
          <Pressable style={s.btn} onPress={() => onLogout(false)}><Text style={s.btnText}>Sign out</Text></Pressable>
          <Pressable style={[s.btn, { borderColor: theme.red }]} onPress={() => onLogout(true)}><Text style={[s.btnText, { color: theme.red }]}>Sign out everywhere</Text></Pressable>
        </View>
        <Text style={s.legal}>HDS Group · Your messages are stored securely and only seen by William and the HDS team.</Text>
      </ScrollView>
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  root: { flex: 1 },
  h2: { fontSize: 15, marginTop: 22, marginBottom: 8, color: t.muted, textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: '600' },
  label: { fontSize: 13, color: t.muted },
  muted: { fontSize: 13, color: t.muted },
  rowForm: { flexDirection: 'row', gap: 8, marginVertical: 6 },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, padding: 10 },
  btn: { borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontWeight: '600', color: t.ink },
  card: { borderWidth: 1, borderRadius: 12, padding: 12 },
  step: { flexDirection: 'row', gap: 10 },
  stepTitle: { fontWeight: '700', color: t.ink },
  stepText: { marginVertical: 4, fontSize: 13.5, color: t.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16 },
  chipText: { fontSize: 13.5 },
  session: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1 },
  thisDevice: { fontSize: 11, backgroundColor: '#e8eefb', color: '#1b4f9c', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden', fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
  legal: { fontSize: 12, color: t.muted, textAlign: 'center', marginTop: 18, lineHeight: 17 },
});
