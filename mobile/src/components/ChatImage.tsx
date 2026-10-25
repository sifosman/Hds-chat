import React, { useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../lib/theme';

function ImageContent({ uri, w, h }: { uri: string; w: number; h: number }) {
  const theme = useTheme();
  const [phase, setPhase] = useState<'loading' | 'ok' | 'error'>('loading');
  const [nonce, setNonce] = useState(0);
  if (phase === 'error') {
    return (
      <Pressable style={[s.retry, { width: w, height: h }]} onPress={() => { setPhase('loading'); setNonce(n => n + 1); }} accessibilityLabel="Image unavailable. Tap to retry.">
        <Ionicons name="image-outline" size={26} color={theme.muted} />
        <Text style={[s.failText, { color: theme.muted }]}>Photo unavailable · tap to retry</Text>
      </Pressable>
    );
  }
  return (
    <View style={{ width: w, height: h, overflow: 'hidden' }}>
      <Image
        key={nonce}
        source={{ uri }}
        style={{ width: w, height: h }}
        resizeMode="cover"
        fadeDuration={0}
        resizeMethod="resize"
        onLoad={() => setPhase('ok')}
        onError={() => setPhase('error')}
      />
      {phase === 'loading' && <ActivityIndicator style={s.spin} color={theme.muted} />}
    </View>
  );
}

export function ChatImage({ uri, style, onPress, w, h }: { uri: string; style?: StyleProp<ViewStyle>; onPress?: () => void; w?: number; h?: number }) {
  const theme = useTheme();
  // Callers that know the box up front seed it so the image mounts in the first frame;
  // onLayout stays as the correction path for callers that don't.
  const [box, setBox] = useState<{ w: number; h: number } | null>(() => (w && h ? { w, h } : null));
  return (
    <Pressable
      onPress={uri ? onPress : undefined}
      accessibilityLabel={uri ? 'View image' : 'Photo unavailable'}
      onLayout={e => {
        const { width, height } = e.nativeEvent.layout;
        setBox(b => (b && b.w === width && b.h === height) ? b : { w: width, h: height });
      }}
      style={[s.box, { backgroundColor: theme.dark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)' }, style]}
    >
      {uri ? (
        box ? <ImageContent key={uri} uri={uri} w={box.w} h={box.h} /> : <ActivityIndicator color={theme.muted} />
      ) : (
        <View style={s.fail}>
          <Ionicons name="image-outline" size={26} color={theme.muted} />
          <Text style={[s.failText, { color: theme.muted }]}>Photo unavailable</Text>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  box: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  fail: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8 },
  failText: { fontSize: 12, textAlign: 'center' },
  retry: { alignItems: 'center', justifyContent: 'center', gap: 4, padding: 8 },
  spin: { ...StyleSheet.absoluteFillObject },
});
