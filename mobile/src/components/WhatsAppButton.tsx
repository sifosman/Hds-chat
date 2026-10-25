import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const GREEN = '#128C7E';

// Messaging action only — never an auth provider. Full WhatsApp green surface
// for both the secondary help link and the elevated no-channel recovery.
export function WhatsAppButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}>
      <Ionicons name="logo-whatsapp" size={22} color="#fff" />
      <Text style={s.label}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  btn: {
    minHeight: 48, borderRadius: 12, backgroundColor: GREEN,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, paddingHorizontal: 16, paddingVertical: 12, marginTop: 12,
  },
  label: { color: '#fff', fontWeight: '600', fontSize: 15, flexShrink: 1 },
});
