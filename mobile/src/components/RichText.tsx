import React from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';
import { richSegments, shortUrl } from '../lib/format';
import { openExternal } from '../lib/api';
import type { Theme } from '../lib/theme';

export function RichText({ text, theme, style, onExternal }: { text: string; theme: Theme; style?: StyleProp<TextStyle>; onExternal?: (url: string) => void }) {
  const segs = richSegments(text);
  const open = onExternal || openExternal;
  return (
    <Text style={style}>
      {segs.map((s, i) => {
        if (s.kind === 'link') return <Text key={i} style={{ color: theme.blue }} onPress={() => open(s.text)}>{shortUrl(s.text)}</Text>;
        const st: TextStyle =
          s.kind === 'bold' ? { fontWeight: '700' }
          : s.kind === 'italic' ? { fontStyle: 'italic' }
          : s.kind === 'strike' ? { textDecorationLine: 'line-through' }
          : s.kind === 'mono' ? { fontFamily: 'monospace' as any, backgroundColor: 'rgba(0,0,0,.06)' }
          : {};
        return <Text key={i} style={st}>{s.text}</Text>;
      })}
    </Text>
  );
}
