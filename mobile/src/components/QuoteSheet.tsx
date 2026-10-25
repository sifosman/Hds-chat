import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { api, openExternal } from '../lib/api';
import { rand } from '../lib/format';
import type { Quote } from '../lib/types';
import { useTheme, type Theme } from '../lib/theme';

export const statusLabel: Record<Quote['status'], string> = { open: 'Open', paid: 'Paid', expired: 'Expired', superseded: 'Replaced' };

export function QuoteCard({ q, onOpen, compact, theme }: { q: Quote; onOpen?: () => void; compact?: boolean; theme: Theme }) {
  const s = cardStyles(theme);
  return (
    <Pressable style={[s.card, compact && s.compact]} onPress={onOpen} disabled={!onOpen}>
      <View style={s.top}>
        <Text style={s.label}>QUOTE</Text>
        <Text style={[s.badge, q.status === 'paid' ? s.badgePaid : q.status === 'open' ? s.badgeOpen : s.badgeDone]}>{statusLabel[q.status]}</Text>
      </View>
      <Text style={s.number}>{q.short_number}</Text>
      <Text style={s.total}>{rand(q.total)} <Text style={s.totalSub}>incl. VAT</Text></Text>
      {!!q.branch && <Text style={s.branch}>{q.branch}</Text>}
      {!compact && q.lines.length > 0 && (
        <View style={s.lines}>
          {q.lines.slice(0, 4).map((l, i) => (
            <View key={i} style={s.line}><Text style={s.lineText} numberOfLines={1}>{l.label}</Text>{l.amount != null && <Text style={s.lineAmt}>{rand(l.amount)}</Text>}</View>
          ))}
          {q.lines.length > 4 && <Text style={s.more}>+{q.lines.length - 4} more</Text>}
        </View>
      )}
    </Pressable>
  );
}

export function QuoteSheet({ refId, quote: initial, onClose, onAsk }: { refId?: string; quote?: Quote; onClose: () => void; onAsk: (text: string) => void }) {
  const theme = useTheme();
  const s = sheetStyles(theme);
  const [q, setQ] = useState<Quote | null>(initial || null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (initial) { setQ(initial); setErr(''); return; }
    if (!refId) return;
    let live = true;
    const ac = new AbortController();
    setQ(null); setErr('');
    api<{ quote: Quote }>('/quotes/' + encodeURIComponent(refId), { signal: ac.signal })
      .then(r => { if (live) setQ(r.quote); })
      .catch(e => { if (live) setErr(e.message); });
    return () => { live = false; ac.abort(); };
  }, [refId, initial]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={e => e.stopPropagation()}>
          <Pressable style={s.close} onPress={onClose} accessibilityLabel="Close"><Ionicons name="close" size={22} color={theme.muted} /></Pressable>
          {!q && !err && <Text style={s.loading}>Loading quote…</Text>}
          {!!err && <Text style={s.error}>{err === 'not_found' ? 'We could not find that quote on your account.' : err}</Text>}
          {q && (
            <ScrollView>
              <QuoteCard q={q} compact theme={theme} />
              <View style={s.meta}>
                <Text style={s.metaText}>Created {new Date(q.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</Text>
                {!!q.expires_at && q.status === 'open' && <Text style={s.metaText}>Valid until {new Date(q.expires_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</Text>}
                <Text style={s.mono}>{q.quote_number}</Text>
              </View>
              <View style={s.lines}>
                {q.lines.map((l, i) => (
                  <View key={i} style={s.line}><Text style={s.lineText}>{l.label}</Text>{l.amount != null && <Text style={s.lineAmt}>{rand(l.amount)}</Text>}</View>
                ))}
                <View style={[s.line, s.lineTotal]}><Text style={[s.lineText, { fontWeight: '700' }]}>Total incl. VAT</Text><Text style={[s.lineAmt, { fontWeight: '700' }]}>{rand(q.total)}</Text></View>
              </View>
              {q.invoice && (
                <View style={[s.invoice, q.invoice.status === 'paid' && s.invoicePaid]}>
                  <Text style={s.invoiceText}>Invoice {q.invoice.number}: <Text style={{ fontWeight: '700' }}>{q.invoice.status === 'paid' ? 'Paid ✓' : 'Not paid yet'}</Text></Text>
                </View>
              )}
              <View style={s.actions}>
                <Pressable style={s.btn} onPress={() => openExternal(q.pdf_url)}><Ionicons name="download-outline" size={16} color={theme.ink} /><Text style={s.btnText}> Quote PDF</Text></Pressable>
                {!!q.cutlist_url && <Pressable style={s.btn} onPress={() => openExternal(q.cutlist_url!)}><Ionicons name="download-outline" size={16} color={theme.ink} /><Text style={s.btnText}> Cutting list</Text></Pressable>}
                {!!q.invoice?.pdf_url && <Pressable style={s.btn} onPress={() => openExternal(q.invoice!.pdf_url!)}><Ionicons name="download-outline" size={16} color={theme.ink} /><Text style={s.btnText}> Invoice</Text></Pressable>}
              </View>
              {q.status === 'open' && (
                <View style={s.actions}>
                  <Pressable style={[s.btn, s.btnPrimary]} onPress={() => { onAsk(`I'd like to pay for quote ${q.short_number}`); onClose(); }}><Text style={s.btnPrimaryText}>Pay for this quote</Text></Pressable>
                  <Pressable style={s.btn} onPress={() => { onAsk(`I have a question about quote ${q.short_number}`); onClose(); }}><Text style={s.btnText}>Ask William</Text></Pressable>
                </View>
              )}
              {(q.status === 'expired' || q.status === 'paid') && (
                <View style={s.actions}>
                  <Pressable style={[s.btn, s.btnPrimary]} onPress={() => { onAsk(`Please re-quote ${q.short_number} — same list`); onClose(); }}><Text style={s.btnPrimaryText}>Order this again</Text></Pressable>
                </View>
              )}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const cardStyles = (t: Theme) => StyleSheet.create({
  card: { backgroundColor: '#fff6f6', borderWidth: 1, borderColor: '#f3c9cb', borderRadius: 10, padding: 12, minWidth: 230 },
  compact: {},
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: 11, letterSpacing: 1, color: '#e3242b', fontWeight: '700' },
  badge: { fontSize: 11, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, fontWeight: '600', overflow: 'hidden' },
  badgeOpen: { backgroundColor: '#e8eefb', color: '#1b4f9c' },
  badgePaid: { backgroundColor: '#e3f5e8', color: '#1e7b3a' },
  badgeDone: { backgroundColor: '#eee', color: '#666' },
  number: { fontWeight: '600', fontSize: 15, marginTop: 2, color: '#111' },
  total: { fontSize: 22, fontWeight: '800', marginVertical: 2, color: '#111' },
  totalSub: { fontSize: 12, fontWeight: '500', color: '#667781' },
  branch: { fontSize: 13, color: '#445' },
  lines: { marginTop: 8 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 3, borderTopWidth: 1, borderTopColor: '#eee', borderStyle: 'dashed' },
  lineText: { fontSize: 13, color: '#333', flex: 1 },
  lineAmt: { fontSize: 13, fontWeight: '700', color: '#111' },
  more: { fontSize: 13, color: '#667781', paddingVertical: 3, borderTopWidth: 1, borderTopColor: '#eee', borderStyle: 'dashed' },
});

const sheetStyles = (t: Theme) => StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,.45)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: t.panel, maxHeight: '88%', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, paddingBottom: 34 },
  close: { position: 'absolute', right: 10, top: 10, zIndex: 2, padding: 6 },
  loading: { padding: 30, textAlign: 'center', color: t.muted },
  error: { backgroundColor: '#fdecea', color: '#8a1c1c', borderRadius: 10, padding: 10, marginTop: 12, fontSize: 14 },
  meta: { marginVertical: 8, gap: 2 },
  metaText: { fontSize: 13, color: t.muted },
  mono: { fontSize: 11.5, color: t.muted, fontFamily: 'monospace' as any },
  lines: { marginTop: 4 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, paddingVertical: 5, borderTopWidth: 1, borderTopColor: t.line },
  lineText: { fontSize: 13.5, color: t.ink, flex: 1 },
  lineAmt: { fontSize: 13.5, fontWeight: '600', color: t.ink },
  lineTotal: { borderTopColor: t.muted },
  invoice: { marginVertical: 10, padding: 10, borderRadius: 8, backgroundColor: '#fff5e0' },
  invoicePaid: { backgroundColor: '#e3f5e8' },
  invoiceText: { fontSize: 14, color: '#333' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  btn: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: t.panel },
  btnText: { fontWeight: '600', color: t.ink, fontSize: 14 },
  btnPrimary: { backgroundColor: t.red, borderColor: t.red },
  btnPrimaryText: { fontWeight: '600', color: '#fff', fontSize: 14 },
});
