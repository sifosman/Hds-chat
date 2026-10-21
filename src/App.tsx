import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { IconChat, IconQuotes, IconUser } from './components/Icons';
import { InstallSheet } from './components/InstallSheet';
import { api, auth, native } from './lib/api';
import { chat, send, start, stop } from './lib/chat';
import { cachedUser, cacheUser, wipeLocal } from './lib/localdb';
import { refreshPush } from './lib/push';
import type { Me } from './lib/types';
import { Account } from './screens/Account';
import { Chat } from './screens/Chat';
import { Invite } from './screens/Invite';
import { Login } from './screens/Login';
import { Quotes } from './screens/Quotes';

type Tab = 'chat' | 'quotes' | 'account';
const inviteToken = () => location.pathname.match(/^\/i\/([A-Za-z0-9_-]{30,100})$/)?.[1] || null;

export function App() {
  const [me, setMe] = useState<Me | null>(null);
  const [boot, setBoot] = useState(true);
  const [invite, setInvite] = useState<string | null>(inviteToken());
  const [tab, setTab] = useState<Tab>('chat');
  const s = useSyncExternalStore(chat.subscribe, chat.get);

  const generation = useRef(0);
  const cleanup = useRef<Promise<void>>(Promise.resolve());
  const clearSession = () => {
    ++generation.current;
    stop(); setMe(null); setBoot(false); setTab('chat');
    // Serialize cleanup with sign-in, including automatic 401 logout events.
    cleanup.current = cleanup.current.catch(() => {}).then(() => wipeLocal());
    void cleanup.current.catch(() => {});
  };

  useEffect(() => {
    const epoch = ++generation.current;
    const token = auth.token;
    const controller = new AbortController();
    const valid = () => generation.current === epoch && auth.token === token && !controller.signal.aborted;
    const out = () => { controller.abort(); clearSession(); };
    window.addEventListener('hds:logout', out);
    void (async () => {
      if (token) {
        const cached = await cachedUser(token).catch(() => null);
        if (!valid()) return;
        if (cached) { setMe(cached); setBoot(false); }
        try {
          const r = await api<{ user: Me }>('/me', { signal: controller.signal });
          if (!valid()) return;
          setMe(r.user);
          await cacheUser(token, r.user, valid).catch(() => {});
        } catch { /* Keep the session-bound cached identity usable while offline. */ }
      }
      if (valid()) setBoot(false);
    })();
    return () => { ++generation.current; controller.abort(); window.removeEventListener('hds:logout', out); };
  }, []);

  useEffect(() => {
    if (!me) return;
    void start(me).catch(() => {});
    void refreshPush().catch(() => {});
    if (native.on) native.post({ type: 'ready' });
    return () => stop();
  }, [me?.id]);

  const signedIn = async (u: Me) => {
    const epoch = ++generation.current;
    const token = auth.token;
    stop(); setMe(null);
    if (!token) return;
    const valid = () => generation.current === epoch && auth.token === token;
    await cleanup.current.catch(() => {});
    if (!valid()) return;
    // Queue the wipe immediately so another login cannot write before it finishes.
    cleanup.current = wipeLocal();
    await cleanup.current;
    if (!valid()) return;
    await cacheUser(token, u, valid);
    if (!valid()) return;
    setInvite(null); setMe(u); setBoot(false); setTab('chat');
  };
  const logout = async (all: boolean) => {
    // Start revocation with the old token, but clear local data immediately even offline.
    void api('/auth/logout', { method: 'POST', body: { all } }).catch(() => {});
    auth.clear(); clearSession();
    await cleanup.current.catch(() => {});
  };
  const ask = (t: string) => { setTab('chat'); send({ type: 'text', body: t }); };

  if (invite && !me) return <Invite token={invite} onDone={signedIn} onFallback={() => setInvite(null)} />;
  if (boot) return <div className="splash"><img src="/icons/icon-192.png" alt="" /></div>;
  if (!me) return <Login onDone={signedIn} />;

  const typing = s.typingUntil > Date.now();
  return (
    <div className="app">
      <header className="top">
        <img src="/icons/icon-192.png" alt="" className="avatar" />
        <div className="top-text">
          <div className="top-title">{tab === 'chat' ? 'William · HDS' : tab === 'quotes' ? 'My quotes' : 'Account'}</div>
          <div className="top-sub">{!s.online ? 'Waiting for network…' : tab !== 'chat' ? 'HDS Cut & Edge' : typing ? 'typing…' : 'HDS sales assistant · replies 24/7'}</div>
        </div>
      </header>
      <main className="main">
        {tab === 'chat' && <Chat />}
        {tab === 'quotes' && <Quotes onAsk={ask} />}
        {tab === 'account' && <Account me={me} onLogout={logout} onAsk={ask} />}
      </main>
      <nav className="tabs">
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}><IconChat />Chat</button>
        <button className={tab === 'quotes' ? 'on' : ''} onClick={() => setTab('quotes')}><IconQuotes />Quotes</button>
        <button className={tab === 'account' ? 'on' : ''} onClick={() => setTab('account')}><IconUser />Account</button>
      </nav>
      <InstallSheet />
    </div>
  );
}
