import { useEffect, useRef, useState } from 'react';
import { send } from '../lib/chat';
import { compressImage, VoiceRecorder } from '../lib/media';
import { IconCamera, IconClip, IconDoc, IconMic, IconPin, IconSend, IconTrash } from './Icons';

export function Composer({ onError }: { onError: (m: string) => void }) {
  const [text, setText] = useState('');
  const [menu, setMenu] = useState(false);
  const [rec, setRec] = useState<{ r: VoiceRecorder; secs: number; level: number } | null>(null);
  const ta = useRef<HTMLTextAreaElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const doc = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = ta.current; if (!el) return;
    el.style.height = 'auto'; el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  }, [text]);

  useEffect(() => {
    if (!rec) return;
    const t = setInterval(() => setRec(r => (r ? { ...r, secs: Math.floor((Date.now() - r.r.startedAt) / 1000) } : r)), 250);
    return () => clearInterval(t);
  }, [!!rec]);

  const sendText = () => {
    const t = text.trim();
    if (!t) return;
    if (t.length > 4096) { onError('Please split your message or attach a document. Messages are limited to 4,096 characters.'); return; }
    send({ type: 'text', body: t });
    setText('');
    ta.current?.focus();
  };

  async function onFiles(files: FileList | null, kind: 'image' | 'document') {
    if (text.trim().length > 4096) { onError('Please shorten the attachment caption to 4,096 characters.'); return; }
    setMenu(false);
    for (const f of Array.from(files || []).slice(0, 10)) {
      if (f.size > 25 * 1024 * 1024) { onError(`${f.name} is larger than 25 MB.`); continue; }
      if (kind === 'image' && f.type.startsWith('image/')) {
        const { blob, mime } = await compressImage(f);
        send({ type: 'image', blob, mime, filename: f.name.replace(/\.\w+$/, '.jpg'), body: text.trim() || undefined });
        setText('');
      } else {
        send({ type: 'document', blob: f, mime: f.type || 'application/octet-stream', filename: f.name, body: text.trim() || undefined });
        setText('');
      }
    }
  }

  function shareLocation() {
    setMenu(false);
    if (!navigator.geolocation) return onError('Location is not available on this device.');
    navigator.geolocation.getCurrentPosition(
      p => send({ type: 'location', location: { lat: +p.coords.latitude.toFixed(6), lon: +p.coords.longitude.toFixed(6), name: 'My location' } }),
      () => onError('Could not get your location. Please allow location access and try again.'),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function startRec() {
    try {
      const r = new VoiceRecorder();
      r.onLevel = level => setRec(s => (s ? { ...s, level } : s));
      await r.start();
      setRec({ r, secs: 0, level: 0 });
    } catch { onError('Microphone access is needed for voice notes.'); }
  }
  async function stopRec(sendIt: boolean) {
    if (!rec) return;
    const r = rec.r; setRec(null);
    if (!sendIt || Date.now() - r.startedAt < 800) { r.cancel(); return; }
    const blob = await r.stop();
    send({ type: 'audio', blob, mime: 'audio/wav', filename: 'voice-note.wav' });
  }

  if (rec) {
    return (
      <div className="composer recording">
        <button className="icon-btn" onClick={() => stopRec(false)} aria-label="Cancel recording"><IconTrash /></button>
        <div className="rec-indicator"><span className="dot" style={{ transform: `scale(${1 + rec.level * 2})` }} /> Recording {Math.floor(rec.secs / 60)}:{String(rec.secs % 60).padStart(2, '0')}</div>
        <button className="send-btn" onClick={() => stopRec(true)} aria-label="Send voice note"><IconSend /></button>
      </div>
    );
  }

  return (
    <div className="composer-wrap">
      {menu && (
        <div className="attach-menu">
          <button onClick={() => camera.current?.click()}><span className="am-ic cam"><IconCamera /></span>Camera</button>
          <button onClick={() => photo.current?.click()}><span className="am-ic pho"><IconCamera /></span>Photos</button>
          <button onClick={() => doc.current?.click()}><span className="am-ic doc"><IconDoc /></span>Document</button>
          <button onClick={shareLocation}><span className="am-ic loc"><IconPin /></span>Location</button>
        </div>
      )}
      <div className="composer">
        <div className="composer-pill">
          <button className="icon-btn" onClick={() => setMenu(m => !m)} aria-label="Attach"><IconClip /></button>
          <textarea
            ref={ta} rows={1} value={text} placeholder="Message" aria-label="Message"
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && window.matchMedia('(pointer: fine)').matches) { e.preventDefault(); sendText(); } }}
          />
        </div>
        {text.trim()
          ? <button className="send-btn" onClick={sendText} aria-label="Send"><IconSend /></button>
          : <button className="send-btn" onClick={startRec} aria-label="Record voice note"><IconMic /></button>}
      </div>
      <input ref={photo} type="file" accept="image/*" multiple hidden onChange={e => { onFiles(e.target.files, 'image'); e.target.value = ''; }} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={e => { onFiles(e.target.files, 'image'); e.target.value = ''; }} />
      <input ref={doc} type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,image/*" multiple hidden onChange={e => { onFiles(e.target.files, 'document'); e.target.value = ''; }} />
    </div>
  );
}
