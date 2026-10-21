import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bubble } from '../components/Bubble';
import { Composer } from '../components/Composer';
import { QuoteSheet } from '../components/QuoteSheet';
import { SetupCard } from '../components/SetupCard';
import { chat, discard, loadHistory, loadOlder, retry, send } from '../lib/chat';
import { dayLabel } from '../lib/format';
import type { Msg } from '../lib/types';

export function Chat() {
  const s = useSyncExternalStore(chat.subscribe, chat.get);
  const list = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [viewer, setViewer] = useState<string | null>(null);
  const [quoteRef, setQuoteRef] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [, tick] = useState(0);
  const typing = s.typingUntil > Date.now();

  useEffect(() => { if (!typing) return; const t = setTimeout(() => tick(x => x + 1), s.typingUntil - Date.now() + 50); return () => clearTimeout(t); }, [s.typingUntil, typing]);
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(''), 4000); return () => clearTimeout(t); }, [toast]);

  const all: Msg[] = useMemo(() => [...s.history, ...s.messages], [s.history, s.messages]);

  useLayoutEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [all.length, typing, s.loaded]);

  const onScroll = async () => {
    const el = list.current!;
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
    if (el.scrollTop < 40 && !loadingOlder.current) {
      loadingOlder.current = true;
      const h = el.scrollHeight;
      const n = await loadOlder().catch(() => 0);
      if (!n && s.historyMore && s.historyLoaded) await loadHistory().catch(() => {});
      requestAnimationFrame(() => { el.scrollTop = el.scrollHeight - h + el.scrollTop; loadingOlder.current = false; });
    }
  };
  const loadingOlder = useRef(false);

  const reply = (t: string) => { stick.current = true; send({ type: 'interactive', body: t }); };
  const ask = (t: string) => { stick.current = true; send({ type: 'text', body: t }); };

  let lastDay = '';
  const lastTheirs = [...s.messages].reverse().find(m => m.direction === 'out');

  return (
    <div className="chat">
      <div className="messages" ref={list} onScroll={onScroll}>
        <div className="history-cta">
          {!s.historyLoaded ? (
            <button className="link" onClick={() => loadHistory().catch(e => setToast(e.message))}>Show earlier WhatsApp messages</button>
          ) : s.historyMore ? (
            <button className="link" onClick={() => loadHistory().catch(e => setToast(e.message))}>Load more WhatsApp history</button>
          ) : s.history.length ? <span className="muted">Start of your WhatsApp history</span> : <span className="muted">No earlier WhatsApp messages</span>}
        </div>
        {s.messages.some(m => m.direction === 'out') && <SetupCard inline />}
        {s.loaded && s.messages.length === 0 && (
          <div className="welcome">
            <div className="welcome-title">Hi{s.me?.name ? ' ' + s.me.name.split(' ')[0] : ''} 👋</div>
            <p>This is your direct line to HDS. William can quote you from a cutting list (type it, send a photo or a document), find your nearest branch, send product pictures and take payments, any time.</p>
            <div className="chips">
              {['I need a quote', 'Find my nearest branch', 'Show me board colours', 'Check my payment'].map(t => <button key={t} className="chip" onClick={() => ask(t)}>{t}</button>)}
            </div>
          </div>
        )}
        {all.map((m, i) => {
          const d = dayLabel(m.created_at);
          const sep = d !== lastDay ? (lastDay = d) : null;
          const prev = all[i - 1];
          const showName = !prev || prev.direction !== m.direction || prev.sender !== m.sender || !!sep;
          return (
            <div key={m.id}>
              {sep && <div className="day"><span>{sep}</span></div>}
              {prev?.payload?.channel === 'whatsapp' && m.payload?.channel !== 'whatsapp' && <div className="day app-start"><span>Continued in the HDS app</span></div>}
              <Bubble m={m} showName={showName} isLast={m === lastTheirs} onImage={setViewer} onQuote={setQuoteRef} onReply={reply} onRetry={retry} onDiscard={discard} />
            </div>
          );
        })}
        {typing && <div className="row theirs"><div className="bubble typing" aria-label="William is typing"><span /><span /><span /></div></div>}
      </div>
      {toast && <div className="toast" role="status">{toast}</div>}
      <Composer onError={setToast} />
      {viewer && <div className="viewer" onClick={() => setViewer(null)}><img src={viewer} alt="" /></div>}
      {quoteRef && <QuoteSheet refId={quoteRef} onClose={() => setQuoteRef(null)} onAsk={ask} />}
    </div>
  );
}
