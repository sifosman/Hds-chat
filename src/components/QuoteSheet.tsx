import { useEffect, useState } from 'react';
import { api, openExternal } from '../lib/api';
import { rand } from '../lib/format';
import type { Quote } from '../lib/types';
import { IconClose, IconDownload } from './Icons';

export const statusLabel: Record<Quote['status'], string> = { open: 'Open', paid: 'Paid', expired: 'Expired', superseded: 'Replaced' };

export function QuoteCard({ q, onOpen, compact }: { q: Quote; onOpen?: () => void; compact?: boolean }) {
  return (
    <div className={'quote-card' + (compact ? ' compact' : '')} onClick={onOpen} role={onOpen ? 'button' : undefined}>
      <div className="qc-top">
        <span className="qc-label">Quote</span>
        <span className={'badge badge-' + q.status}>{statusLabel[q.status]}</span>
      </div>
      <div className="qc-number">{q.short_number}</div>
      <div className="qc-total">{rand(q.total)} <span>incl. VAT</span></div>
      {q.branch && <div className="qc-branch">{q.branch}</div>}
      {!compact && q.lines.length > 0 && (
        <ul className="qc-lines">
          {q.lines.slice(0, 4).map((l, i) => <li key={i}><span>{l.label}</span>{l.amount != null && <b>{rand(l.amount)}</b>}</li>)}
          {q.lines.length > 4 && <li className="more">+{q.lines.length - 4} more</li>}
        </ul>
      )}
    </div>
  );
}

export function QuoteSheet({ refId, quote: initial, onClose, onAsk }: { refId?: string; quote?: Quote; onClose: () => void; onAsk: (text: string) => void }) {
  const [q, setQ] = useState<Quote | null>(initial || null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (initial) { setQ(initial); return; }
    if (!refId) return;
    api<{ quote: Quote }>('/quotes/' + encodeURIComponent(refId)).then(r => setQ(r.quote)).catch(e => setErr(e.message));
  }, [refId, initial]);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()} role="dialog" aria-label="Quote details">
        <button className="sheet-close" onClick={onClose} aria-label="Close"><IconClose /></button>
        {!q && !err && <div className="sheet-loading">Loading quote…</div>}
        {err && <div className="error">{err === 'not_found' ? 'We could not find that quote on your account.' : err}</div>}
        {q && (
          <>
            <QuoteCard q={q} compact />
            <div className="qs-meta">
              <div>Created {new Date(q.created_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
              {q.expires_at && q.status === 'open' && <div>Valid until {new Date(q.expires_at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' })}</div>}
              <div className="qs-full">{q.quote_number}</div>
            </div>
            <ul className="qc-lines full">
              {q.lines.map((l, i) => <li key={i}><span>{l.label}</span>{l.amount != null && <b>{rand(l.amount)}</b>}</li>)}
              <li className="total"><span>Total incl. VAT</span><b>{rand(q.total)}</b></li>
            </ul>
            {q.invoice && (
              <div className={'qs-invoice ' + q.invoice.status}>
                Invoice {q.invoice.number}: <b>{q.invoice.status === 'paid' ? 'Paid ✓' : 'Not paid yet'}</b>
              </div>
            )}
            <div className="qs-actions">
              <button className="btn" onClick={() => openExternal(q.pdf_url)}><IconDownload size={18} /> Quote PDF</button>
              {q.cutlist_url && <button className="btn" onClick={() => openExternal(q.cutlist_url!)}><IconDownload size={18} /> Cutting list</button>}
              {q.invoice?.pdf_url && <button className="btn" onClick={() => openExternal(q.invoice!.pdf_url!)}><IconDownload size={18} /> Invoice</button>}
            </div>
            {q.status === 'open' && (
              <div className="qs-actions">
                <button className="btn primary" onClick={() => { onAsk(`I'd like to pay for quote ${q.short_number}`); onClose(); }}>Pay for this quote</button>
                <button className="btn" onClick={() => { onAsk(`I have a question about quote ${q.short_number}`); onClose(); }}>Ask William</button>
              </div>
            )}
            {(q.status === 'expired' || q.status === 'paid') && (
              <div className="qs-actions">
                <button className="btn primary" onClick={() => { onAsk(`Please re-quote ${q.short_number} — same list`); onClose(); }}>Order this again</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
