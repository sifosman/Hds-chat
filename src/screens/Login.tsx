import { useEffect, useRef, useState } from 'react';
import { api, ApiError, auth, native } from '../lib/api';
import type { Me } from '../lib/types';

export function Login({ onDone }: { onDone: (me: Me) => void }) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [channel, setChannel] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [noChannel, setNoChannel] = useState(false);
  const [wait, setWait] = useState(0);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (wait <= 0) return; const t = setTimeout(() => setWait(w => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  useEffect(() => { if (step === 'code') codeRef.current?.focus(); }, [step]);

  // the field shows a fixed +27; accept "082…", "82…", "27…" or a full "+44…" number
  const full = () => {
    const t = phone.trim();
    if (t.startsWith('+') || t.startsWith('00')) return t;
    const d = t.replace(/\D/g, '');
    return '+27' + (d.startsWith('27') && d.length === 11 ? d.slice(2) : d.replace(/^0/, ''));
  };
  async function start() {
    setBusy(true); setErr(''); setNoChannel(false);
    try {
      const r = await api('/auth/otp/start', { method: 'POST', body: { phone: full() } });
      setChannel(r.channel); setStep('code'); setWait(45);
    } catch (e) {
      const x = e as ApiError; setErr(x.message); setNoChannel(x.code === 'no_channel');
    } finally { setBusy(false); }
  }
  async function verify(c = code) {
    if (c.length !== 6) return;
    setBusy(true); setErr('');
    try {
      const r = await api('/auth/otp/verify', { method: 'POST', body: { phone: full(), code: c, platform: native.on ? 'android-app' : 'web', device: navigator.userAgent.slice(0, 80) } });
      auth.set(r.token); onDone(r.user);
    } catch (e) { setErr((e as Error).message); setCode(''); } finally { setBusy(false); }
  }
  const where = channel === 'sms' ? 'by SMS' : channel === 'whatsapp' ? 'on WhatsApp' : channel === 'email' ? 'to your email' : '';

  return (
    <div className="auth">
      <img className="auth-logo" src="/icons/logo-dark.png" alt="HDS Cut & Edge" />
      <h1>Chat with HDS</h1>
      <p className="auth-sub">Quotes, cutting lists, payments and your nearest branch — in our own app.</p>
      {step === 'phone' ? (
        <form onSubmit={e => { e.preventDefault(); start(); }}>
          <label htmlFor="phone">Your cellphone number</label>
          <div className="phone-input">
            <span>+27</span>
            <input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="82 123 4567" value={phone} onChange={e => setPhone(e.target.value)} required />
          </div>
          <p className="hint">Use the number you chat to us on WhatsApp with — your quotes and history come with you.</p>
          <button className="btn primary block" disabled={busy || phone.replace(/\D/g, '').length < 9}>{busy ? 'Sending…' : 'Send code'}</button>
          {err && <div className="error">{err}</div>}
          {noChannel && <a className="btn block" href="https://wa.me/27787060895?text=Hi%20HDS%2C%20I%27d%20like%20my%20app%20code">Message us on WhatsApp</a>}
        </form>
      ) : (
        <form onSubmit={e => { e.preventDefault(); verify(); }}>
          <label htmlFor="code">Enter the 6-digit code we sent {where}</label>
          <input id="code" ref={codeRef} className="code-input" type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
            onChange={e => { const v = e.target.value.replace(/\D/g, '').slice(0, 6); setCode(v); if (v.length === 6) verify(v); }} />
          <button className="btn primary block" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Continue'}</button>
          {err && <div className="error">{err}</div>}
          <div className="auth-links">
            <button type="button" className="link" disabled={wait > 0 || busy} onClick={start}>{wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}</button>
            <button type="button" className="link" onClick={() => { setStep('phone'); setCode(''); setErr(''); }}>Change number</button>
          </div>
        </form>
      )}
      <p className="legal">HDS uses this chat to help with your quotes and orders. William is an AI assistant; HDS staff can also assist. <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy and pilot information</a>.</p>
    </div>
  );
}
