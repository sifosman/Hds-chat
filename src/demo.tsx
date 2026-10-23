// Dev-only visual harness: renders the real chat shell + Bubble components with
// fake data so design changes can be screenshotted without a backend.
// Open /demo.html on the vite dev server. Not part of the production build —
// keep markup here in sync with App.tsx / Chat.tsx / Composer.tsx when their
// structure changes.
import { createRoot } from 'react-dom/client';
import { Bubble } from './components/Bubble';
import { IconChat, IconClip, IconMic, IconQuotes, IconUser } from './components/Icons';
import type { Msg } from './lib/types';
import './styles.css';

const now = Date.now();
const t = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();

const msgs: Msg[] = [
  { id: '1', direction: 'out', sender: 'bot', type: 'text', body: 'Hi Asif 👋 What can I help you with today?', payload: {}, status: 'read', created_at: t(95) },
  { id: '2', direction: 'in', sender: 'customer', type: 'text', body: 'Hi, do you have gloss boards?', payload: {}, status: 'read', created_at: t(90) },
  {
    id: '3', direction: 'out', sender: 'bot', type: 'carousel', body: 'Here are some products from HDS Group.',
    payload: {
      cards: [
        { image: '/icons/icon-512.png', text: 'Black Strata Gloss 2700 x 600 x 22mm 1 Long - R785', buttons: [{ text: 'View product', url: 'https://example.com/a' }] },
        { image: '/icons/icon-512.png', text: 'Cloudstone Gloss 2700 x 600 x 22mm 1 Long - R785', buttons: [{ text: 'View product', url: 'https://example.com/b' }] },
      ],
    }, status: 'read', created_at: t(85),
  },
  { id: '4', direction: 'out', sender: 'bot', type: 'text', body: "Sent you a few gloss options! We've got Olivia, Metropolitan Loft, Metallic Cappuccino, Dune and Dakota Oak Gloss (CHROMETREE, R2,150/sheet), plus Black Strata and Cloudstone gloss worktops (R785). We also do grey shades in gloss if you're after that — want me to pull those up too, or quote any of these?", payload: { quick_replies: 'x' } as any, status: 'read', created_at: t(84) },
  { id: '5', direction: 'in', sender: 'customer', type: 'text', body: 'Yes please, quote me on 2 sheets of Olivia', payload: {}, status: 'read', created_at: t(80) },
  {
    id: '6', direction: 'out', sender: 'bot', type: 'document', body: 'Here is your quote.',
    payload: { quote: { quote_number: 'Q-20261023-1234-abcd', short_number: 'Q-1234', created_at: t(80), expires_at: null, total: 4945, vat: 645, branch: 'Alberton', project: null, status: 'open', pdf_url: '#', cutlist_url: null, invoice: null, lines: [{ label: 'Olivia Gloss 2750x1830', amount: 4300 }, { label: 'Cutting', amount: 0 }] } },
    status: 'delivered', created_at: t(78),
  },
  { id: '7', direction: 'in', sender: 'customer', type: 'text', body: 'Perfect, thanks!', payload: {}, status: 'read', created_at: t(2) },
  { id: '8', direction: 'out', sender: 'bot', type: 'text', body: 'Any time! Need anything else?', payload: {}, status: 'delivered', created_at: t(1) },
];

function Demo() {
  let lastDay = '';
  return (
    <div className="app">
      <header className="top">
        <img src="/icons/icon-192.png" alt="" className="avatar" />
        <div className="top-text">
          <div className="top-title">William · HDS</div>
          <div className="top-sub">HDS sales assistant · replies 24/7</div>
        </div>
      </header>
      <main className="main">
        <div className="chat">
          <div className="messages">
            <div className="history-cta"><span className="muted">Start of your WhatsApp history</span></div>
            {msgs.map((m, i) => {
              const prev = msgs[i - 1];
              const d = new Date(m.created_at).toDateString();
              const sep = d !== lastDay ? (lastDay = d) : null;
              const showName = !prev || prev.direction !== m.direction || prev.sender !== m.sender || !!sep;
              return (
                <div key={m.id}>
                  {sep && <div className="day"><span>Today</span></div>}
                  <Bubble m={m} showName={showName} isLast={i === msgs.length - 1} onImage={() => {}} onQuote={() => {}} onReply={() => {}} onRetry={() => {}} onDiscard={() => {}} />
                </div>
              );
            })}
            <div className="row theirs"><div className="bubble typing"><span /><span /><span /></div></div>
          </div>
          <div className="composer-wrap">
            <div className="composer">
              <div className="composer-pill">
                <button className="icon-btn" aria-label="Attach"><IconClip /></button>
                <textarea rows={1} placeholder="Message" aria-label="Message" />
              </div>
              <button className="send-btn" aria-label="Record voice note"><IconMic /></button>
            </div>
          </div>
        </div>
      </main>
      <nav className="tabs">
        <button className="on"><span className="tab-ic"><IconChat /></span>Chat</button>
        <button><span className="tab-ic"><IconQuotes /></span>Quotes</button>
        <button><span className="tab-ic"><IconUser /></span>Account</button>
      </nav>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Demo />);
