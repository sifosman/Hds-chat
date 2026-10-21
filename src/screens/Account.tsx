import { useEffect, useState } from 'react';
import { SetupCard } from '../components/SetupCard';
import { api } from '../lib/api';
import type { Me } from '../lib/types';

export function Account({ me, onLogout, onAsk }: { me: Me; onLogout: (all: boolean) => void; onAsk: (t: string) => void }) {
  const [name, setName] = useState(me.name || '');
  const [saved, setSaved] = useState(false);
  const [sessions, setSessions] = useState<any[]>([]);
  const load = () => api('/sessions').then(r => setSessions(r.sessions)).catch(() => {});
  useEffect(() => { load(); }, []);
  return (
    <div className="page account">
      <section>
        <h2>Your details</h2>
        <label htmlFor="nm">Name</label>
        <div className="row-form">
          <input id="nm" value={name} onChange={e => { setName(e.target.value); setSaved(false); }} />
          <button className="btn" disabled={!name.trim()} onClick={async () => { await api('/me', { method: 'PATCH', body: { name } }); setSaved(true); }}>{saved ? 'Saved ✓' : 'Save'}</button>
        </div>
        <div className="muted">Cellphone: +{me.phone}</div>
      </section>
      <section><h2>App & notifications</h2><SetupCard /></section>
      <section>
        <h2>Help</h2>
        <div className="chips">
          <button className="chip" onClick={() => onAsk('I would like to speak to a person please')}>Talk to a person</button>
          <button className="chip" onClick={() => onAsk('Which branch is nearest to me?')}>Nearest branch</button>
        </div>
      </section>
      <section>
        <h2>Devices</h2>
        {sessions.map(s => (
          <div className="session" key={s.id}>
            <div><b>{s.platform === 'android-app' ? 'Android app' : s.platform === 'web' ? 'Browser' : s.platform}</b>{s.current && <span className="badge badge-open">This device</span>}
              <div className="muted">{(s.device_label || '').slice(0, 40)} · last used {new Date(s.last_used_at).toLocaleDateString('en-ZA')}</div></div>
            {!s.current && <button className="link" onClick={async () => { await api('/sessions/' + s.id, { method: 'DELETE' }); load(); }}>Sign out</button>}
          </div>
        ))}
        <div className="qs-actions">
          <button className="btn" onClick={() => onLogout(false)}>Sign out</button>
          <button className="btn danger" onClick={() => onLogout(true)}>Sign out everywhere</button>
        </div>
      </section>
      <p className="legal">HDS Group · Your messages are stored securely and only seen by William and the HDS team.</p>
    </div>
  );
}
