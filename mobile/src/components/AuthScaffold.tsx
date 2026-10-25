import React, { useEffect, useState, type ReactNode } from 'react';
import { Image, Keyboard, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';
import { entranceTheme, jost, type EntranceTheme } from '../lib/entrance';

// Static shared entrance shell: black masthead with the official logo, one
// edge-to-edge kitchen photograph, then a solid ivory/charcoal form surface.
// The photograph is dropped entirely on compact (code/invite) screens, small
// heights and while the keyboard is up so the form always fits.
export function AuthScaffold({ compact = false, headline, support, children, footer, jostLoaded = false }: {
  compact?: boolean; headline?: string; support?: string; children: ReactNode; footer?: ReactNode; jostLoaded?: boolean;
}) {
  const dark = useTheme().dark;
  const t = entranceTheme(dark);
  const s = styles(t, jostLoaded);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => setKb(true));
    const b = Keyboard.addListener('keyboardDidHide', () => setKb(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  const h = compact || kb ? 0 : (height < 620 ? 120 : Math.min(Math.max(width * 0.52, 180), 230, Math.round(height * 0.26)));
  return (
    <View style={{ flex: 1, backgroundColor: '#000' }}>
      <View style={[s.masthead, { paddingTop: insets.top + 10 }]}>
        <Image source={require('../../assets/logo-dark.png')} style={s.logo} resizeMode="contain" accessibilityLabel="HDS" />
      </View>
      {h > 0 && (
        <Image source={require('../../assets/entrance/hero.jpg')} style={[s.photo, { height: h }]} resizeMode="cover" />
      )}
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1 }}>
        <View style={s.body}>
          {!!headline && <Text style={[s.headline, { color: t.ink }, jost(jostLoaded, '600')]}>{headline}</Text>}
          {!!support && <Text style={[s.support, { color: t.muted }, jost(jostLoaded)]}>{support}</Text>}
          {children}
          {footer}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = (t: EntranceTheme, jostOk: boolean) => StyleSheet.create({
  masthead: { backgroundColor: '#000', paddingBottom: 12, paddingHorizontal: 24 },
  logo: { width: 132, height: 56, alignSelf: 'center' },
  photo: { width: '100%', overflow: 'hidden' },
  body: {
    paddingHorizontal: 24, paddingTop: 24, paddingBottom: 40,
    width: '100%', maxWidth: 520, alignSelf: 'center', flexGrow: 1,
  },
  headline: { fontSize: 28, lineHeight: 34, ...jost(jostOk, '600') },
  support: { fontSize: 15, lineHeight: 22, marginTop: 8, ...jost(jostOk) },
});
