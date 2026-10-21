import { useEffect, useState } from 'react';
import { native } from '../lib/api';
import { canPromptInstall, isIOS, isStandalone, onInstallChange, promptInstall } from '../lib/install';
import { IconBell, IconChat, IconClose, IconDownload, IconQuotes, IconTag } from './Icons';

const SNOOZE = 'hds.install.snooze';
const SNOOZE_MS = 7 * 864e5;

/** Install bottom-sheet shown once after sign-in (snoozed a week on "Not now" / dismiss).
 *  One-tap install where the browser offers beforeinstallprompt; guided steps elsewhere. */
export function InstallSheet() {
  const [show, setShow] = useState(false);
  const [, force] = useState(0);
  useEffect(() => onInstallChange(() => force(x => x + 1)), []);
  useEffect(() => {
    if (isStandalone() || native.on || Number(localStorage.getItem(SNOOZE) || 0) > Date.now()) return;
    const t = setTimeout(() => setShow(true), 1200);
    return () => clearTimeout(t);
  }, []);
  if (!show) return null;

  const snooze = () => { localStorage.setItem(SNOOZE, String(Date.now() + SNOOZE_MS)); setShow(false); };
  const install = async () => { if (await promptInstall()) setShow(false); else snooze(); };

  return (
    <div className="sheet-backdrop" onClick={snooze}>
      <div className="sheet install-sheet" role="dialog" aria-label="Install the HDS app" onClick={e => e.stopPropagation()}>
        <button className="sheet-close" onClick={snooze} aria-label="Not now"><IconClose size={20} /></button>
        <img className="install-icon" src="/icons/icon-192.png" alt="" />
        <h2>Put HDS on your home screen</h2>
        <p className="install-sub">Your chat, quotes and pay links — one tap away, no WhatsApp needed.</p>
        <ul className="install-perks">
          <li><IconChat size={18} /> Chat with William &amp; the team</li>
          <li><IconQuotes size={18} /> Quotes and invoices instantly</li>
          <li><IconBell size={18} /> Know the moment we reply</li>
          <li><IconTag size={18} /> App-only specials &amp; promos</li>
        </ul>
        {canPromptInstall() ? (
          <button className="btn block install-cta cta" onClick={install}><IconDownload size={18} /> Install app</button>
        ) : isIOS() ? (
          <div className="install-steps">
            <p><b>1.</b> Tap the <b>Share</b> button in Safari</p>
            <p><b>2.</b> Choose <b>Add to Home Screen</b></p>
            <p><b>3.</b> Tap <b>Add</b> — done</p>
          </div>
        ) : (
          <div className="install-steps">
            <p><b>1.</b> Tap the <b>⋮</b> menu in your browser</p>
            <p><b>2.</b> Choose <b>Install app</b> or <b>Add to Home screen</b></p>
          </div>
        )}
        <button className="link install-later" onClick={snooze}>Not now</button>
      </div>
    </div>
  );
}
