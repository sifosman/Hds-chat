import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { QuoteCard, QuoteSheet } from '../components/QuoteSheet';
import { Header } from '../components/Header';
import { api, auth } from '../lib/api';
import { kvGet, kvSet, localWrite } from '../lib/localdb';
import { createQuotesFeed, type QuotesFeed } from '../lib/quotesfeed';
import type { Quote } from '../lib/types';
import { useTheme, type Theme } from '../lib/theme';

export function Quotes({ onAsk }: { onAsk: (t: string) => void }) {
  const theme = useTheme();
  const s = styles(theme);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [open, setOpen] = useState<Quote | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'paid'>('all');
  const [err, setErr] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // Immutable token captured at mount — a new session remounts this screen via the
  // shell's keyed NavigationContainer, so anything captured here can never adopt a
  // newer account. live() additionally re-checks auth.token === token so responses
  // and queued writes from the old session stay fenced out after logout.
  const token = useRef(auth.token).current;
  const mounted = useRef(true);
  const live = useCallback(() => mounted.current && !!token && auth.token === token, [token]);
  const feedRef = useRef<QuotesFeed | null>(null);
  if (!feedRef.current) {
    feedRef.current = createQuotesFeed<Quote>({
      live,
      fetch: signal => api<{ quotes: Quote[] }>('/quotes', { signal }).then(r => r.quotes),
      loadCache: () => kvGet<Quote[] | null>('quotes', null),
      queueWrite: localWrite,
      writeCache: q => kvSet('quotes', q),
      onQuotes: q => {
        setQuotes(q);
        setErr('');
        setOpen(previous => (previous ? q.find(x => x.quote_number === previous.quote_number) || previous : null));
      },
      onCached: q => setQuotes(c => c || q),
      onError: setErr,
    });
  }
  const feed = feedRef.current;

  const pull = useCallback(() => {
    setRefreshing(true);
    void feed.pull().finally(() => { if (live()) setRefreshing(false); });
  }, [feed, live]);

  useEffect(() => {
    mounted.current = true;
    void feed.restore();
    const poll = () => { if (AppState.currentState === 'active') void feed.pull(); };
    poll();
    const timer = setInterval(poll, 30000);
    const sub = AppState.addEventListener('change', st => { if (st === 'active') poll(); });
    return () => {
      mounted.current = false;
      feed.close();
      clearInterval(timer);
      sub.remove();
    };
  }, [feed]);

  const shown = (quotes || []).filter(q => q.status !== 'superseded' && (filter === 'all' || q.status === filter));
  return (
    <View style={[s.root, { backgroundColor: theme.panel }]}>
      <Header title="My quotes" sub="HDS Cut & Edge" />
      <View style={[s.seg, { backgroundColor: theme.bg }]}>
        {(['all', 'open', 'paid'] as const).map(f => (
          <Pressable key={f} style={[s.segBtn, filter === f && [s.segOn, { backgroundColor: theme.panel }]]} onPress={() => setFilter(f)}>
            <Text style={[s.segText, { color: filter === f ? theme.ink : theme.muted }]}>{f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Paid'}</Text>
          </Pressable>
        ))}
      </View>
      {!!err && !quotes && <Text style={s.error}>{err}</Text>}
      {!quotes && !err && <Text style={[s.center, { color: theme.muted }]}>Loading your quotes…</Text>}
      <FlatList
        data={shown}
        keyExtractor={q => q.quote_number}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={pull} tintColor={theme.red} />}
        contentContainerStyle={{ padding: 12, gap: 10, flexGrow: 1 }}
        renderItem={({ item }) => <QuoteCard q={item} theme={theme} onOpen={() => setOpen(item)} />}
        ListEmptyComponent={quotes ? (
          <View style={s.empty}>
            <Text style={{ color: theme.muted, marginBottom: 12 }}>No quotes here yet.</Text>
            <Pressable style={[s.btn, { backgroundColor: theme.red, borderColor: theme.red }]} onPress={() => onAsk('I need a quote')}><Text style={s.btnPrimaryText}>Ask William for a quote</Text></Pressable>
          </View>
        ) : null}
      />
      {!!open && <QuoteSheet quote={open} onClose={() => setOpen(null)} onAsk={onAsk} />}
    </View>
  );
}

const styles = (t: Theme) => StyleSheet.create({
  root: { flex: 1 },
  seg: { flexDirection: 'row', borderRadius: 10, padding: 3, margin: 12, marginBottom: 0 },
  segBtn: { flex: 1, paddingVertical: 7, borderRadius: 8, alignItems: 'center' },
  segOn: { shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  segText: { fontWeight: '500' },
  center: { textAlign: 'center', padding: 24 },
  error: { backgroundColor: '#fdecea', color: '#8a1c1c', borderRadius: 10, padding: 10, margin: 12, fontSize: 14 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  btn: { borderWidth: 1, borderColor: t.line, borderRadius: 10, padding: 12, alignItems: 'center' },
  btnPrimaryText: { color: '#fff', fontWeight: '700' },
});
