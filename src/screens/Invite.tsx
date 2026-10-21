import { useEffect, useState } from 'react';
import { api, auth, native } from '../lib/api';
import type { Me } from '../lib/types';

/** Invite link landing. The token is only consumed by the explicit "Continue" POST, never on page load,
 *  so SMS/WhatsApp link scanners can't burn it. */
export function Invite({ token, onDone, onFallback }: { token: string; onDone: (me: Me) => void; onFallback: () => void }) {
  const [info, setInfo] = useState<{ name: string; phone: string } | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/auth/invite/peek', { method: 'POST', body: { token } }).then(setInfo).catch(e => setErr(e.message)); }, [token]);

  async function go() {
    setBusy(true);
    try {
      const r = await api('/auth/invite/redeem', { method: 'POST', body: { token, platform: native.on ? 'android-app' : 'web', device: navigator.userAgent.slice(0, 80) } });
      auth.set(r.token);
      history.replaceState(null, '', '/');
      onDone(r.user);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="auth">
      <img className="auth-logo" src="/icons/logo-wide.png" alt="HDS Cut & Edge" />
      {err ? (
        <>
          <h1>Link not valid</h1>
          <p className="auth-sub">{err} You can sign in with your cellphone number instead.</p>
          <button className="btn primary block" onClick={() => { history.replaceState(null, '', '/'); onFallback(); }}>Sign in with my number</button>
        </>
      ) : !info ? <p className="auth-sub">Checking your link…</p> : (
        <>
          <h1>Hi{info.name ? ' ' + info.name : ''} 👋</h1>
          <p className="auth-sub">Your HDS chat with William, your quotes and invoices are ready for <b>{info.phone}</b>.</p>
          <button className="btn primary block" disabled={busy} onClick={go}>{busy ? 'Opening…' : 'Continue'}</button>
          <p className="hint">Not you? <button className="link" onClick={() => { history.replaceState(null, '', '/'); onFallback(); }}>Sign in with another number</button></p>
        </>
      )}
    </div>
  );
}
