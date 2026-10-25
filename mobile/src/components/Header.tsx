import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../lib/theme';

/** Red top bar shared by the three tabs — mirrors the web .top header. */
export function Header({ title, sub }: { title: string; sub: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[st.top, { paddingTop: 6 + insets.top, backgroundColor: theme.red }]}>
      <Image source={require('../../assets/icon.png')} style={st.avatar} />
      <View>
        <Text style={st.title}>{title}</Text>
        <Text style={st.sub}>{sub}</Text>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  top: {
    flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 16, paddingBottom: 8,
    shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 3, shadowOffset: { width: 0, height: 1 }, elevation: 3, zIndex: 2,
  },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#000' },
  title: { fontWeight: '600', fontSize: 16.5, lineHeight: 20, color: '#fff' },
  sub: { fontSize: 12, color: 'rgba(255,255,255,.88)', marginTop: 1 },
});
