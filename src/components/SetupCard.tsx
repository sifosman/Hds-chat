import { useEffect, useState } from 'react';
import { api, getConfig, native } from '../lib/api';
import { canPromptInstall, installDone, isAndroid, isIOS, onInstallChange, promptInstall } from '../lib/install';
import { enablePush, pushState, PushState } from '../lib/push';
import { IconBell, IconClose, IconDownload } from './Icons';

const DISMISS = 'hds.setup.dismissed';

/** "Get set up" — one guided card: install the app, then turn on notifications. */
export function SetupCard({ inline }: { inline?: boolean }) {
  const [, force] = useState(0);
  const [push, setPush] = useState<PushState>(pushState());
  const [apk, setApk] = useState<string | null>(null);
  const [iosHelp, setIosHelp] = useState(false);
  const [dismissed, setDismissed] = useState(() => inline && Number(localStorage.getItem(DISMISS) || 0) > Date.now());
  useEffect(() => onInstallChange(() => force(x => x + 1)), []);
  useEffect(() => { getConfig().then(c => setApk(c.android_apk_url)).catch(() => {}); }, []);
  useEffect(() => {
    const onPush = () => setPush(pushState());
    window.addEventListener('hds:native-push-status', onPush);
    return () => window.removeEventListener('hds:native-push-status', onPush);
  }, []);

  const installed = installDone();
  const needInstall = !installed;
  const needPush = push === 'default';
  if (native.on && push === 'unsupported') return inline ? null : <div className="setup">Notifications are not available on this device. Open the chat to check for replies.</div>;
  if (!needInstall && push === 'denied') return inline ? null : <div className="setup">Notifications are blocked in your device settings. You can enable them there.</div>;
  if (dismissed || (!needInstall && !needPush)) return inline ? null : <div className="setup done">App installed{push === 'granted' ? ' · notifications allowed' : ''} ✓</div>;

  const dismiss = () => { localStorage.setItem(DISMISS, String(Date.now() + 3 * 864e5)); setDismissed(true); };
  const apkCta = !!apk && isAndroid() && !native.on;
  const getApk = () => { api('/events', { method: 'POST', body: { event: 'apk_download' } }).catch(() => {}); location.href = apk!; };

  return (
    <div className={'setup' + (inline ? ' inline' : '')}>
      {inline && <button className="setup-x" onClick={dismiss} aria-label="Dismiss"><IconClose size={18} /></button>}
      <div className="setup-title">Get the most out of HDS chat</div>
      {needInstall && (
        <div className="setup-step">
          <IconDownload />
          <div>
            <b>{apkCta ? 'Install the HDS app' : 'Add HDS to your home screen'}</b>
            <p>Quotes and chat in one tap — plus app-only specials and promos.</p>
            {apkCta && (
              <>
                <button className="btn cta" onClick={getApk}>Get the Android app</button>
                <p className="apk-hint">If Android asks, allow the install — it's the official HDS app.</p>
              </>
            )}
            {!apkCta && canPromptInstall() && <button className="btn cta" onClick={() => promptInstall()}>Install app</button>}
            {isIOS() && <button className="btn" onClick={() => setIosHelp(v => !v)}>How to install on iPhone</button>}
            {iosHelp && <ol className="ios-help"><li>Tap the <b>Share</b> button <span aria-hidden>⎋</span> at the bottom of Safari</li><li>Choose <b>Add to Home Screen</b></li><li>Open HDS from your home screen and turn on notifications</li></ol>}
          </div>
        </div>
      )}
      {needPush && !(isIOS() && !installed) && (
        <div className="setup-step">
          <IconBell />
          <div>
            <b>App-only specials &amp; promos</b>
            <p>Deals land here first — plus you'll know the moment William sends your quote or the team replies.</p>
            <button className="btn cta" onClick={async () => { const r = await enablePush().catch(() => pushState()); setPush(r); }}>Turn on notifications</button>
          </div>
        </div>
      )}
    </div>
  );
}
