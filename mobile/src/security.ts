export const APP_ORIGIN = 'https://chat.hdsgroup.co.za';
export const HOME_URL = `${APP_ORIGIN}/`;

function parseHttps(value: unknown): URL | null {
  if (typeof value !== 'string' || value.length > 8192 || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url : null;
  } catch { return null; }
}

export function isTrustedUrl(value: unknown): boolean {
  return parseHttps(value)?.origin === APP_ORIGIN;
}

/** Only HTTPS may ever reach the system browser. No intent:, file:, or JS URLs. */
export function externalHttps(value: unknown): string | null {
  return parseHttps(value)?.href ?? null;
}

export function navigationAction(value: unknown): 'webview' | 'browser' | 'block' {
  const url = parseHttps(value);
  if (!url) return 'block';
  if (url.origin !== APP_ORIGIN || /\.pdf$/i.test(url.pathname)) return 'browser';
  return 'webview';
}

/** Supports hds-chat://app/i/TOKEN and verified HTTPS app links. */
export function appDeepLink(value: unknown): string | null {
  if (isTrustedUrl(value)) return navigationAction(value) === 'webview' ? String(value) : null;
  if (typeof value !== 'string' || /[\u0000-\u0020\u007f\\]/.test(value)) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'hds-chat:' || url.hostname !== 'app' || url.username || url.password || url.port) return null;
    const target = `${APP_ORIGIN}${url.pathname}${url.search}${url.hash}`;
    return navigationAction(target) === 'webview' ? target : null;
  } catch { return null; }
}

export type BridgeMessage = { type: 'ready' } | { type: 'push:register' } | { type: 'camera:request' } | { type: 'open'; url: string } | { type: 'chrome'; bar: 'light' | 'dark' };
export function parseBridgeMessage(raw: string, sourceUrl: string): BridgeMessage | null {
  if (!isTrustedUrl(sourceUrl) || raw.length > 16384) return null;
  try {
    const message: unknown = JSON.parse(raw);
    if (!message || typeof message !== 'object' || !('type' in message)) return null;
    if (message.type === 'ready' || message.type === 'push:register' || message.type === 'camera:request') return { type: message.type };
    if (message.type === 'chrome' && 'bar' in message && (message.bar === 'light' || message.bar === 'dark')) return { type: 'chrome', bar: message.bar };
    if (message.type === 'open' && 'url' in message) {
      const url = externalHttps(message.url);
      return url ? { type: 'open', url } : null;
    }
  } catch { /* Untrusted payload: ignore. */ }
  return null;
}
