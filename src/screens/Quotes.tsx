import { useEffect, useState } from 'react';
import { QuoteCard, QuoteSheet } from '../components/QuoteSheet';
import { api } from '../lib/api';
import { kvGet, kvSet } from '../lib/localdb';
import type { Quote } from '../lib/types';

export function Quotes({ onAsk }: { onAsk: (t: string) => void }) {
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [open, setOpen] = useState<Quote | null>(null);
  const [filter, setFilter] = useState<'all' | 'open' | 'paid'>('all');
  const [err, setErr] = useState('');
  useEffect(() => {
    let active = true;
    const ac = new AbortController();
    kvGet<Quote[] | null>('quotes', null).then(q => { if (active && q) setQuotes(c => c || q); });
    const refresh = () => {
      if (document.visibilityState !== 'visible') return;
      api<{ quotes: Quote[] }>('/quotes', {signal: ac.signal}).then(r => {
        if (!active) return;
        setQuotes(r.quotes); setErr('');
        setOpen(previous => previous ? r.quotes.find(q => q.quote_number === previous.quote_number) || previous : null);
        kvSet('quotes', r.quotes);
      }).catch(e => { if (active) setErr(e.message); });
    };
    refresh();
    const timer = setInterval(refresh, 30000);
    window.addEventListener('focus', refresh);
    return () => { active = false; ac.abort(); clearInterval(timer); window.removeEventListener('focus', refresh); };
  }, []);
  const shown = (quotes || []).filter(q => q.status !== 'superseded' && (filter === 'all' || q.status === filter));
  return (
    <div className="page">
      <div className="seg">
        {(['all', 'open', 'paid'] as const).map(f => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Paid'}</button>)}
      </div>
      {err && !quotes && <div className="error">{err}</div>}
      {!quotes && !err && <div className="muted center">Loading your quotes…</div>}
      {quotes && shown.length === 0 && (
        <div className="empty">
          <p>No quotes here yet.</p>
          <button className="btn primary" onClick={() => onAsk('I need a quote')}>Ask William for a quote</button>
        </div>
      )}
      <div className="quote-list">{shown.map(q => <QuoteCard key={q.quote_number} q={q} onOpen={() => setOpen(q)} />)}</div>
      {open && <QuoteSheet quote={open} onClose={() => setOpen(null)} onAsk={onAsk} />}
    </div>
  );
}
