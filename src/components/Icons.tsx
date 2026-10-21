const I = (d: string, vb = '0 0 24 24') => (p: { size?: number; className?: string }) => (
  <svg width={p.size || 22} height={p.size || 22} viewBox={vb} className={p.className} fill="currentColor" aria-hidden="true"><path d={d} /></svg>
);
export const IconSend = I('M3.4 20.4 21.8 12 3.4 3.6 3.4 10l13.2 2-13.2 2z');
export const IconMic = I('M12 14a3 3 0 0 0 3-3V5a3 3 0 1 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11h-2Z');
export const IconClip = I('M16.5 6.5v10a4.5 4.5 0 0 1-9 0V5a3 3 0 0 1 6 0v10.5a1.5 1.5 0 0 1-3 0V6.5H9v9a3 3 0 0 0 6 0V5a4.5 4.5 0 0 0-9 0v11.5a6 6 0 0 0 12 0v-10h-1.5Z');
export const IconCamera = I('M12 8.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9ZM9 3 7.2 5H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9Z');
export const IconDoc = I('M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm0 1.5L18.5 8H14V3.5ZM8 13h8v1.5H8V13Zm0 3h8v1.5H8V16Z');
export const IconPin = I('M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7Zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5Z');
export const IconChat = I('M4 3h16a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H7l-5 4V5a2 2 0 0 1 2-2Z');
export const IconQuotes = I('M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm8 1.5V8h4.5L14 3.5ZM7 12h10v1.5H7V12Zm0 3h10v1.5H7V15Zm0 3h6v1.5H7V18Z');
export const IconUser = I('M12 12a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0 2c-4.42 0-8 2.24-8 5v3h16v-3c0-2.76-3.58-5-8-5Z');
export const IconClock = I('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm.75 5v5.19l3.53 3.53-1.06 1.06-3.97-3.97V7h1.5Z');
export const IconCheck = I('M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z');
export const IconChecks = I('M17.7 6.3 9 15l-1.6-1.6-1.4 1.4L9 17.8 19.1 7.7l-1.4-1.4ZM22.6 6.3 14 15l-.6-.6-1.4 1.4 2 2 10-10-1.4-1.5ZM1.4 13.4 5.5 17.5 6.9 16 2.8 12z');
export const IconAlert = I('M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z');
export const IconClose = I('M19 6.4 17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z');
export const IconBack = I('M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z');
export const IconBell = I('M12 22a2 2 0 0 0 2-2h-4a2 2 0 0 0 2 2Zm6-6V11a6 6 0 0 0-5-5.91V4a1 1 0 0 0-2 0v1.09A6 6 0 0 0 6 11v5l-2 2v1h16v-1l-2-2Z');
export const IconDownload = I('M5 20h14v-2H5v2ZM19 9h-4V3H9v6H5l7 7 7-7Z');
export const IconTag = I('M21.4 11.6 12.4 2.6A2 2 0 0 0 11 2H4a2 2 0 0 0-2 2v7c0 .5.2 1 .6 1.4l9 9a2 2 0 0 0 2.8 0l7-7a2 2 0 0 0 0-2.8ZM6.5 8A1.5 1.5 0 1 1 8 6.5 1.5 1.5 0 0 1 6.5 8Z');
export const IconPlay = I('M8 5v14l11-7z');
export const IconPause = I('M6 5h4v14H6zM14 5h4v14h-4z');
export const IconTrash = I('M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z');
export const IconExternal = I('M14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7ZM19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7Z');
