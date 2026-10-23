import { memo, useRef, useState } from 'react';
import { openExternal } from '../lib/api';
import { RichText, time } from '../lib/format';
import type { Msg } from '../lib/types';
import { IconAlert, IconCheck, IconChecks, IconClock, IconDoc, IconPause, IconPin, IconPlay } from './Icons';
import { QuoteCard } from './QuoteSheet';

function Ticks({ m }: { m: Msg }) {
  if (m.direction !== 'in') return null;
  if (m.status === 'sending') return <IconClock size={14} className="tick" />;
  if (m.status === 'failed') return <IconAlert size={14} className="tick failed" />;
  if (m.status === 'sent') return <IconCheck size={15} className="tick" />;
  return <IconChecks size={16} className={'tick' + (m.status === 'read' ? ' read' : '')} />;
}

function Audio({ src }: { src: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(0);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return (
    <div className="voice">
      <button className="voice-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => { const a = ref.current!; if (a.paused) a.play(); else a.pause(); }}>
        {playing ? <IconPause size={20} /> : <IconPlay size={20} />}
      </button>
      <div className="voice-bar"><div style={{ width: dur ? (pos / dur) * 100 + '%' : 0 }} /></div>
      <span className="voice-time">{fmt(playing || pos ? pos : dur)}</span>
      <audio ref={ref} src={src} preload="metadata" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => { setPlaying(false); setPos(0); }}
        onTimeUpdate={e => setPos(e.currentTarget.currentTime)} onLoadedMetadata={e => setDur(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)} />
    </div>
  );
}

export interface BubbleProps {
  m: Msg; showName: boolean; isLast: boolean;
  onImage: (src: string) => void; onQuote: (ref: string) => void; onReply: (text: string) => void; onRetry: (m: Msg) => void; onDiscard: (m: Msg) => void;
}

export const Bubble = memo(function Bubble({ m, showName, isLast, onImage, onQuote, onReply, onRetry, onDiscard }: BubbleProps) {
  const mine = m.direction === 'in';
  const src = m.localBlobUrl || m.media_url || '';
  const p = m.payload || {};
  const name = m.sender === 'agent' ? (m.sender_name || 'HDS team') : m.sender === 'bot' ? 'William' : m.sender === 'system' ? 'HDS service' : '';
  const isHistory = p.channel === 'whatsapp';
  return (
    <div className={`row ${mine ? 'mine' : 'theirs'}${isHistory ? ' history' : ''}${showName ? ' grp' : ''}`}>
      <div className={`bubble type-${m.type}${m.sender === 'agent' ? ' agent' : ''}`}>
        {showName && !mine && <div className="sender">{name}{m.sender === 'agent' && <span className="staff-tag">HDS team</span>}</div>}

        {m.type === 'image' && src && <img className="media-img" src={src} alt={m.body || 'Photo'} loading="lazy" onClick={() => onImage(src)} />}
        {m.type === 'video' && src && <video className="media-img" src={src} controls preload="metadata" />}
        {m.type === 'audio' && src && <Audio src={src} />}
        {p.quote && <QuoteCard q={p.quote} onOpen={() => onQuote(p.quote.quote_number)} />}
        {m.type === 'document' && !p.quote && (
          <button className="doc" onClick={() => src && openExternal(src)}>
            <IconDoc size={28} /><span>{p.filename || 'Document'}</span>
          </button>
        )}
        {m.type === 'location' && p.location && (
          <button className="doc" onClick={() => openExternal(`https://maps.google.com/?q=${p.location.lat},${p.location.lon}`)}>
            <IconPin size={26} /><span>{p.location.name || 'Shared location'}</span>
          </button>
        )}
        {m.type === 'carousel' && m.body && <div className="text carousel-caption"><RichText text={m.body} /></div>}
        {m.type === 'carousel' && (
          <div className="carousel">
            {(p.cards || []).map((c: any, i: number) => (
              <div className="card" key={i}>
                {c.image && <img src={c.image} alt="" loading="lazy" onClick={() => onImage(c.image)} />}
                {c.text && <div className="card-text"><RichText text={c.text} /></div>}
                {(c.buttons || []).map((b: any, j: number) => <button key={j} className="card-btn" onClick={() => openExternal(b.url)}>{b.text}</button>)}
                {(c.quick_replies || []).map((t: string, j: number) => <button key={'q' + j} className="card-btn" onClick={() => onReply(t)}>{t}</button>)}
              </div>
            ))}
          </div>
        )}

        {m.body && m.type !== 'carousel' && <div className="text"><RichText text={m.body} /></div>}
        {p.footer && <div className="footer-text">{p.footer}</div>}

        {(p.pay_links || []).map((u: string) => <button key={u} className="pay-btn" onClick={() => openExternal(u)}>Pay now securely</button>)}
        {(p.buttons || []).map((b: any, i: number) => <button key={i} className="link-btn" onClick={() => openExternal(b.url)}>{b.text}</button>)}
        {!p.quote && (p.quote_refs || []).length > 0 && (
          <div className="chips">{p.quote_refs.map((r: string) => <button key={r} className="chip" onClick={() => onQuote(r)}>View quote {r.slice(0, 15)}</button>)}</div>
        )}

        <div className="meta">
          {isHistory && <span className="wa-tag">WhatsApp</span>}
          <span>{time(m.created_at)}</span><Ticks m={m} />
        </div>
        {m.status === 'failed' && (
          <div className="failed-actions">
            Not sent. <button onClick={() => onRetry(m)}>Retry</button> · <button onClick={() => onDiscard(m)}>Delete</button>
          </div>
        )}
      </div>
      {isLast && !mine && (p.quick_replies || []).length > 0 && (
        <div className="chips quick">{p.quick_replies.map((t: string) => <button key={t} className="chip" onClick={() => onReply(t)}>{t}</button>)}</div>
      )}
    </div>
  );
});
