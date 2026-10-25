import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import { api, auth } from '../lib/api';
import { RequestGate } from '../lib/gate';
import * as Device from 'expo-device';
import type { Me } from '../lib/types';
import { useTheme } from '../lib/theme';
import { entranceTheme, jost, resolveFixture, type EntranceTheme } from '../lib/entrance';
import { AuthScaffold } from '../components/AuthScaffold';

/** Invite link landing. The token is only consumed by the explicit "Continue" POST, never on
 *  arrival, so link scanners can't burn it. */
export function Invite({ token, onDone, onFallback, jostLoaded = false, demo }: {
  token: string;
  onDone: (me: Me) => void | Promise<void>;
  onFallback: () => void;
  jostLoaded?: boolean;
  demo?: { info?: { name: string; phone: string }; err?: string; loading?: boolean };
}) {
  const dark = useTheme().dark;
  const t = entranceTheme(dark);
  const s = styles(t, jostLoaded);
  const fx = resolveFixture(demo, __DEV__);
  const [info, setInfo] = useState<{ name: string; phone: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const gateRef = useRef(new RequestGate());
  const gate = gateRef.current;
  const inFlight = useRef(false);
  const acRef = useRef<AbortController | null>(null);

  // Peek and redeem are fenced per-token: a late response from an abandoned link
  // can't set info/err or adopt a session for the token currently on screen.
  useEffect(() => {
    if (fx) return;
    const g = gate.bump();
    inFlight.current = false;
    setBusy(false); setInfo(null); setErr('');
    const ac = acRef.current = new AbortController();
    api('/auth/invite/peek', { method: 'POST', body: { token }, signal: ac.signal })
      .then(r => { if (gate.current(g)) setInfo(r); })
      .catch(e => { if (gate.current(g)) setErr(e.message); });
    return () => { gate.bump(); ac.abort(); };
  }, [token, gate, fx]);
  useEffect(() => () => { gate.invalidate(); acRef.current?.abort(); }, [gate]);

  async function go() {
    if (inFlight.current || fx) return;
    inFlight.current = true;
    const g = gate.next();
    setBusy(true);
    try {
      const r = await api('/auth/invite/redeem', {
        method: 'POST',
        body: { token, platform: 'android-app', device: `${Device.manufacturer || ''} ${Device.modelName || 'Android'}`.trim().slice(0, 80) },
      });
      if (!gate.current(g)) return; // token changed/unmounted: don't adopt the session
      auth.set(r.token);
      await onDone(r.user);
    } catch (e) { if (gate.current(g)) setErr((e as Error).message); }
    finally { if (gate.current(g)) { inFlight.current = false; setBusy(false); } }
  }

  const vErr = fx ? fx.err ?? '' : err;
  const vInfo = fx ? fx.info ?? null : info;
  const loading = fx ? !!fx.loading : (!vErr && !vInfo);

  return (
    <AuthScaffold compact jostLoaded={jostLoaded}
      headline={vErr ? 'Let’s get you signed in' : vInfo ? `Hi ${vInfo.name || 'there'}` : 'Your invite'}
      support={vErr ? 'This link can’t be used. Sign in with your cellphone number.' : vInfo ? 'Your HDS chat is ready.' : undefined}>
      {vErr ? (
        <>
          {!!err && !fx && <Text style={s.error} accessibilityLiveRegion="polite">{err}</Text>}
          <Pressable style={({ pressed }) => [s.btnPrimary, pressed && { backgroundColor: t.redPressed }]} onPress={onFallback}
            accessibilityRole="button" accessibilityLabel="Sign in with my number">
            <Text style={s.btnPrimaryText}>Sign in with my number</Text>
          </Pressable>
        </>
      ) : loading ? (
        <>
          <ActivityIndicator color={t.red} size="large" style={{ marginVertical: 18 }} />
          <Text style={s.sub}>Opening your invite…</Text>
        </>
      ) : vInfo ? (
        <>
          <Text style={s.sub}>
            For <Text style={{ fontWeight: '700' }}>{vInfo.phone}</Text>.
          </Text>
          <Pressable style={({ pressed }) => [s.btnPrimary, busy && s.btnOff, pressed && { backgroundColor: t.redPressed }]} disabled={busy} onPress={go}
            accessibilityRole="button" accessibilityState={{ disabled: busy, busy }} accessibilityLabel={busy ? 'Opening your chat' : 'Open my chat'}>
            <Text style={[s.btnPrimaryText, busy && s.btnOffText]}>{busy ? 'Opening…' : 'Open my chat'}</Text>
          </Pressable>
          <Text style={s.hint}>Not you? <Text style={s.hintLink} onPress={onFallback}>Use another number</Text></Text>
        </>
      ) : null}
    </AuthScaffold>
  );
}

const styles = (t: EntranceTheme, jostOk: boolean) => StyleSheet.create({
  sub: { color: t.muted, marginTop: 24, marginBottom: 24, lineHeight: 22, fontSize: 15, ...jost(jostOk) },
  error: { backgroundColor: t.dark ? '#4a2224' : '#fdecea', color: t.dark ? '#ffb4ab' : '#8a1c1c', borderRadius: 10, padding: 10, marginTop: 16, fontSize: 14 },
  hint: { fontSize: 13, color: t.muted, marginTop: 16 },
  hintLink: { color: t.red, fontWeight: '600' },
  btnPrimary: { minHeight: 54, borderRadius: 14, backgroundColor: t.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 4 },
  btnOff: { backgroundColor: t.btnOffBg },
  btnOffText: { color: t.btnOffInk },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 17, ...jost(jostOk, '600') },
});
