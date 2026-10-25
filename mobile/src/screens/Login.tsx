import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { api, ApiError, auth, openExternal } from '../lib/api';
import { RequestGate } from '../lib/gate';
import * as Device from 'expo-device';
import type { Me } from '../lib/types';
import { useTheme } from '../lib/theme';
import { authActionsEnabled, entranceTheme, jost, resolveFixture, WHATSAPP_HELP_URL, type EntranceTheme } from '../lib/entrance';
import { AuthScaffold } from '../components/AuthScaffold';
import { WhatsAppButton } from '../components/WhatsAppButton';

const deviceLabel = () => `${Device.manufacturer || ''} ${Device.modelName || 'Android'}`.trim().slice(0, 80);

export interface LoginPreview { step?: 'phone' | 'code'; phone?: string; channel?: string; noChannel?: boolean; err?: string }

export function Login({ onDone, jostLoaded = false, preview }: { onDone: (me: Me) => void | Promise<void>; jostLoaded?: boolean; preview?: LoginPreview }) {
  const dark = useTheme().dark;
  const t = entranceTheme(dark);
  const s = styles(t, jostLoaded);
  const fixture = resolveFixture(preview, __DEV__);
  const live = authActionsEnabled(!!fixture);
  const [step, setStep] = useState<'phone' | 'code'>(fixture?.step ?? 'phone');
  const [phone, setPhone] = useState(fixture?.phone ?? '');
  const [code, setCode] = useState('');
  const [channel, setChannel] = useState(fixture?.channel ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(fixture?.err ?? '');
  const [noChannel, setNoChannel] = useState(fixture?.noChannel ?? false);
  const [wait, setWait] = useState(0);
  const [focus, setFocus] = useState(false);

  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(t); }, [wait]);

  // the field shows a fixed +27; accept "082…", "82…", "27…" or a full "+44…" number
  const full = () => {
    const t = phone.trim();
    if (t.startsWith('+') || t.startsWith('00')) return t;
    const d = t.replace(/\D/g, '');
    return '+27' + (d.startsWith('27') && d.length === 11 ? d.slice(2) : d.replace(/^0/, ''));
  };
  // Ref-level in-flight guard (button disable lags a frame; the 6-digit auto-submit
  // can double-fire) plus a request gate so a response that resolves after unmount
  // or a newer request can never auth.set or mutate this screen.
  const inFlight = useRef(false);
  const gateRef = useRef(new RequestGate());
  const gate = gateRef.current;
  const acRef = useRef<AbortController | null>(null);
  useEffect(() => () => { gate.invalidate(); acRef.current?.abort(); }, [gate]);

  async function start() {
    if (!live || inFlight.current) return;
    inFlight.current = true;
    const g = gate.next();
    const ac = acRef.current = new AbortController();
    setBusy(true); setErr(''); setNoChannel(false);
    try {
      const r = await api('/auth/otp/start', { method: 'POST', body: { phone: full() }, signal: ac.signal });
      if (!gate.current(g)) return;
      setChannel(r.channel); setStep('code'); setWait(45);
    } catch (e) {
      if (!gate.current(g)) return;
      const x = e as ApiError; setErr(x.message); setNoChannel(x.code === 'no_channel');
    } finally { inFlight.current = false; if (gate.current(g)) setBusy(false); }
  }
  async function verify(c = code) {
    if (c.length !== 6 || !live || inFlight.current) return;
    inFlight.current = true;
    const g = gate.next();
    const ac = acRef.current = new AbortController();
    setBusy(true); setErr('');
    try {
      const r = await api('/auth/otp/verify', { method: 'POST', body: { phone: full(), code: c, platform: 'android-app', device: deviceLabel() }, signal: ac.signal });
      if (!gate.current(g)) return; // abandoned response: never adopt the session
      auth.set(r.token);
      await onDone(r.user);
    } catch (e) { if (gate.current(g)) { setErr((e as Error).message); setCode(''); } }
    finally { inFlight.current = false; if (gate.current(g)) setBusy(false); }
  }
  const where = channel === 'sms' ? 'by SMS' : channel === 'whatsapp' ? 'on WhatsApp' : channel === 'email' ? 'to your email' : '';
  const whatsapp = () => { if (live) openExternal(WHATSAPP_HELP_URL); };
  const privacy = () => { if (live) openExternal('https://chat.hdsgroup.co.za/privacy.html'); };
  const canSend = live && !busy && phone.replace(/\D/g, '').length >= 9;
  const canVerify = live && !busy && code.length === 6;

  const legal = (
    <Text style={s.legal}>William is AI. The HDS team can help too. <Text style={s.legalLink} onPress={privacy}>Privacy & information</Text>.</Text>
  );

  if (step === 'code') {
    return (
      <AuthScaffold compact jostLoaded={jostLoaded}
        headline="Enter your code"
        support={`Sent${where ? ` ${where}` : ''} to ${full()}.`}
        footer={legal}>
        <Text style={s.label}>6-digit code</Text>
        <TextInput style={s.codeInput} keyboardType="number-pad" autoComplete="sms-otp" maxLength={6} value={code} autoFocus
          placeholder="••••••" placeholderTextColor={t.muted} accessibilityLabel="6-digit code"
          onChangeText={v => { const x = v.replace(/\D/g, '').slice(0, 6); setCode(x); if (x.length === 6) verify(x); }} />
        <Pressable style={({ pressed }) => [s.btnPrimary, pressed && { backgroundColor: t.redPressed }, !canVerify && s.btnOff]} disabled={!canVerify}
          onPress={() => verify()} accessibilityRole="button" accessibilityState={{ disabled: !canVerify, busy }}
          accessibilityLabel={busy ? 'Checking code' : 'Continue'}>
          <Text style={[s.btnPrimaryText, !canVerify && s.btnOffText]}>{busy ? 'Checking…' : 'Continue'}</Text>
        </Pressable>
        {!!err && <Text style={s.error} accessibilityLiveRegion="polite">{err}</Text>}
        <View style={s.links}>
          <Pressable disabled={wait > 0 || busy || !live} onPress={start} accessibilityRole="button" accessibilityState={{ disabled: wait > 0 || busy || !live }} hitSlop={8}>
            <Text style={[s.link, (wait > 0 || busy || !live) && { color: t.muted }]}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</Text>
          </Pressable>
          <Pressable disabled={busy} onPress={() => { setStep('phone'); setCode(''); setErr(''); }} accessibilityRole="button" accessibilityState={{ disabled: busy }} hitSlop={8}>
            <Text style={[s.link, busy && { color: t.muted }]}>Change number</Text>
          </Pressable>
        </View>
      </AuthScaffold>
    );
  }

  return (
    <AuthScaffold jostLoaded={jostLoaded}
      headline="Welcome to HDS"
      support="Quotes and orders. One easy chat."
      footer={legal}>
      <Text style={s.label}>Cellphone number</Text>
      <View style={[s.phoneInput, focus && { borderColor: t.red }]}>
        <Text style={s.prefix}>+27</Text>
        <TextInput style={s.phoneField} keyboardType="phone-pad" autoComplete="tel" placeholder="82 123 4567" placeholderTextColor={t.muted}
          accessibilityLabel="Cellphone number"
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
          value={phone} onChangeText={setPhone} onSubmitEditing={start} returnKeyType="send" />
      </View>
      <Text style={s.hint}>Use your WhatsApp number. We’ll send a sign-in code.</Text>
      <Pressable style={({ pressed }) => [s.btnPrimary, pressed && { backgroundColor: t.redPressed }, !canSend && s.btnOff]}
        disabled={!canSend} onPress={start}
        accessibilityRole="button" accessibilityState={{ disabled: !canSend, busy }} accessibilityLabel="Continue">
        <Text style={[s.btnPrimaryText, !canSend && s.btnOffText]}>{busy ? 'Sending…' : 'Continue'}</Text>
      </Pressable>
      {!!err && <Text style={s.error} accessibilityLiveRegion="polite">{err}</Text>}
      {noChannel ? (
        <View style={[s.recovery, { borderColor: t.line }]}>
          <Text style={s.recoveryText}>Message us on WhatsApp, then come back and tap Continue.</Text>
          <WhatsAppButton label="WhatsApp HDS" onPress={whatsapp} />
        </View>
      ) : (
        <View style={s.help}>
          <Text style={s.helpText}>Need a hand?</Text>
          <WhatsAppButton label="WhatsApp HDS" onPress={whatsapp} />
        </View>
      )}
    </AuthScaffold>
  );
}

const styles = (t: EntranceTheme, jostOk: boolean) => StyleSheet.create({
  label: { fontSize: 14, marginBottom: 8, marginTop: 24, color: t.ink, ...jost(jostOk, '500') },
  phoneInput: { flexDirection: 'row', borderWidth: 1.5, borderColor: t.line, borderRadius: 14, overflow: 'hidden', backgroundColor: t.dark ? '#22261f' : '#fff' },
  prefix: { padding: 14, backgroundColor: t.dark ? '#2b2f28' : '#ece5d5', fontWeight: '600', fontSize: 16, color: t.ink },
  phoneField: { flex: 1, padding: 13, fontSize: 18, color: t.ink, ...jost(jostOk, '500') },
  hint: { fontSize: 14, lineHeight: 20, color: t.muted, marginTop: 8 },
  btnPrimary: { minHeight: 54, borderRadius: 14, backgroundColor: t.red, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginTop: 24 },
  btnOff: { backgroundColor: t.btnOffBg },
  btnOffText: { color: t.btnOffInk },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 17, ...jost(jostOk, '600') },
  error: { backgroundColor: t.dark ? '#4a2224' : '#fdecea', color: t.dark ? '#ffb4ab' : '#8a1c1c', borderRadius: 10, padding: 10, marginTop: 12, fontSize: 14 },
  recovery: { borderWidth: 1, borderRadius: 14, padding: 14, marginTop: 16 },
  recoveryText: { color: t.ink, fontSize: 14, lineHeight: 20 },
  help: { marginTop: 4 },
  helpText: { fontSize: 14, color: t.muted, marginTop: 20, marginBottom: 2 },
  codeInput: { fontSize: 32, letterSpacing: 14, textAlign: 'center', padding: 14, borderWidth: 1.5, borderColor: t.line, borderRadius: 14, color: t.ink, backgroundColor: t.dark ? '#22261f' : '#fff', ...jost(jostOk, '600') },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 },
  link: { color: t.red, fontSize: 14, paddingVertical: 10, fontWeight: '600' },
  legal: { fontSize: 12, color: t.muted, marginTop: 24, lineHeight: 17 },
  legalLink: { color: t.red, fontWeight: '600' },
});
