// Entrance (sign-in, code and invite screens) tokens, launch routing and
// dev-fixture helpers. Pure module: no React Native imports so it runs under
// node --test.

export const jostFamily = 'HDS-Jost';
export type JostWeight = '400' | '500' | '600';
// Bundled Jost is the variable font (font-style:normal) from the public HDS
// website. When the font failed to load, components get {} and fall back to
// the platform face.
export const jost = (loaded: boolean, wght: JostWeight = '400'): { fontFamily?: string; fontWeight?: JostWeight } =>
  loaded ? { fontFamily: jostFamily, fontWeight: wght } : {};

export interface EntranceTheme {
  dark: boolean;
  bg: string; ink: string; muted: string; line: string;
  red: string; redPressed: string;
  btnOffBg: string; btnOffInk: string;
  wa: string; waInk: string;
}
export const entranceLight: EntranceTheme = {
  dark: false,
  bg: '#F6F2EA', ink: '#191C1A', muted: '#6b675e', line: '#ddd5c4',
  red: '#e3242b', redPressed: '#b81c22',
  btnOffBg: '#ddd5c4', btnOffInk: '#7a7466',
  wa: '#128C7E', waInk: '#ffffff',
};
export const entranceDark: EntranceTheme = {
  ...entranceLight,
  dark: true,
  bg: '#191C1A', ink: '#F6F2EA', muted: '#aaa59a', line: '#3a3d38',
  btnOffBg: '#31352e', btnOffInk: '#8e897e',
};
export const entranceTheme = (dark: boolean): EntranceTheme => dark ? entranceDark : entranceLight;

export const WHATSAPP_HELP_URL = 'https://wa.me/27787060895?text=Hi%20HDS%2C%20I%27d%20like%20my%20app%20code';

// ---- launch routing -------------------------------------------------------

export interface LaunchState {
  bootDone: boolean;            // session restore finished
  signedIn: boolean;
  initialUrlResolved: boolean;  // getInitialURL settled (invite known or absent)
  invite: boolean;
}
export type LaunchRoute = 'boot' | 'app' | 'invite' | 'auth';

// Precedence: a live session or invite link always wins. Until identity
// restore and the cold-start URL have both settled, the boot frame holds so
// login never flashes mid-resolution. Local assets are not part of routing —
// they load asynchronously behind a platform-font fallback.
export const launchRoute = (s: LaunchState): LaunchRoute =>
  s.signedIn ? 'app'
  : s.invite ? 'invite'
  : !s.bootDone || !s.initialUrlResolved ? 'boot'
  : 'auth';

// ---- dev entrance preview --------------------------------------------------

export const PREVIEW_STATES = [
  'phone', 'otp', 'no_channel', 'error',
  'invite', 'invite_long', 'invite_invalid', 'invite_loading',
  'chat', 'off',
] as const;
export type PreviewState = typeof PREVIEW_STATES[number];

// hds-chat://dev-preview?state=NAME — exact scheme/host only, state must be a
// known fixture name. Anything else is ignored.
export function parsePreviewUrl(value: unknown): PreviewState | null {
  if (typeof value !== 'string' || value.length > 512) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'hds-chat:' || url.username || url.password || url.port) return null;
    if (url.hostname !== 'dev-preview' || (url.pathname && url.pathname !== '/')) return null;
    const st = url.searchParams.get('state') ?? 'phone';
    return (PREVIEW_STATES as readonly string[]).includes(st) ? st as PreviewState : null;
  } catch { return null; }
}

// Fixture props only exist in __DEV__; production ignores them entirely.
export const resolveFixture = <T>(fixture: T | undefined, dev: boolean): T | undefined => dev ? fixture : undefined;

// Every network/external action inside a fixture-rendered auth screen is
// inert: no OTP start/verify, no invite peek/redeem, no browser open.
export const authActionsEnabled = (fixture: boolean) => !fixture;
