import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ token: 'session-a', api: vi.fn(), cached: vi.fn(), cache: vi.fn(), wipe: vi.fn(), start: vi.fn(), stop: vi.fn(), hooks: [] as any[], index: 0, effects: [] as (() => void)[], dirty: false }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<any>();
  return { ...actual,
    useState: (initial: any) => { const i = f.index++; if (!(i in f.hooks)) f.hooks[i] = typeof initial === 'function' ? initial() : initial; return [f.hooks[i], (v: any) => { f.hooks[i] = typeof v === 'function' ? v(f.hooks[i]) : v; f.dirty = true; }]; },
    useRef: (initial: any) => { const i = f.index++; return f.hooks[i] ||= { current: initial }; },
    useEffect: (action: () => any, deps: any[]) => { const i = f.index++; const prev = f.hooks[i]; if (!prev || deps.some((d, j) => d !== prev.deps[j])) { f.effects.push(() => { prev?.cleanup?.(); f.hooks[i] = { deps, cleanup: action() }; }); } },
    useSyncExternalStore: () => ({ online: false, typingUntil: 0 }),
  };
});
vi.mock('../src/lib/api', () => ({ api: f.api, auth: { get token() { return f.token; }, clear: () => { f.token = ''; } }, native: { on: false } }));
vi.mock('../src/lib/chat', () => ({ chat: { subscribe: () => {}, get: () => ({}) }, send: vi.fn(), start: f.start, stop: f.stop }));
vi.mock('../src/lib/localdb', () => ({ cachedUser: f.cached, cacheUser: f.cache, wipeLocal: f.wipe }));
vi.mock('../src/lib/push', () => ({ refreshPush: async () => {} }));
vi.mock('../src/components/Icons', () => ({ IconChat: () => null, IconQuotes: () => null, IconUser: () => null }));
vi.mock('../src/screens/Account', () => ({ Account: () => null }));
vi.mock('../src/screens/Chat', () => ({ Chat: () => null }));
vi.mock('../src/screens/Invite', () => ({ Invite: () => null }));
vi.mock('../src/screens/Login', () => ({ Login: () => null }));
vi.mock('../src/screens/Quotes', () => ({ Quotes: () => null }));
const userA = { id: 'a', phone: '27900000001', name: 'Fixture A', topic: 'topic-a' };
const userB = { id: 'b', phone: '27900000002', name: 'Fixture B', topic: 'topic-b' };
function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
let App: any, view: any;
function render() { f.index = 0; f.dirty = false; view = App(); for (const effect of f.effects.splice(0)) effect(); }
async function settle() { for (let i = 0; i < 30; i++) { await Promise.resolve(); if (f.dirty) render(); } }
beforeEach(async () => {
  vi.resetModules(); vi.resetAllMocks(); f.hooks = []; f.effects = []; f.index = 0; f.dirty = false; f.token = 'session-a';
  vi.stubGlobal('location', { pathname: '/' }); vi.stubGlobal('window', new EventTarget());
  f.cached.mockResolvedValue(null); f.cache.mockResolvedValue(undefined); f.wipe.mockResolvedValue(undefined); f.start.mockResolvedValue(undefined);
  f.api.mockRejectedValue({ status: 0, code: 'offline' });
  ({ App } = await import('../src/' + 'App'));
});
afterEach(() => { for (const hook of f.hooks) hook?.cleanup?.(); vi.unstubAllGlobals(); });

describe('App boot and logout generation fences', () => {
  it('boots from a session-bound cached identity when /me is offline', async () => {
    f.cached.mockResolvedValue(userA); render(); await settle();
    expect(f.cached).toHaveBeenCalledWith('session-a');
    expect(f.start).toHaveBeenCalledWith(userA);
    expect(view.type).toBe('div'); expect(view.props.className).toBe('app');
  });
  it('does not resurrect a user when an old /me request resolves after logout', async () => {
    const response = deferred<any>(); f.api.mockReturnValue(response.promise);
    render(); await settle();
    f.token = ''; (globalThis as any).window.dispatchEvent(new Event('hds:logout')); await settle();
    response.resolve({ user: userA }); await settle();
    expect(f.start).not.toHaveBeenCalled(); expect(f.cache).not.toHaveBeenCalled();
    expect(f.wipe).toHaveBeenCalledOnce(); expect(view.type.name).toBe('Login');
  });
  it('waits for logout cleanup before caching a new signed-in identity', async () => {
    const cleanup = deferred<void>(); f.wipe.mockReturnValueOnce(cleanup.promise);
    render(); await settle();
    f.token = ''; (globalThis as any).window.dispatchEvent(new Event('hds:logout')); await settle();
    f.token = 'session-b'; const login = view.props.onDone(userB); await settle();
    expect(f.cache).not.toHaveBeenCalled(); expect(f.start).not.toHaveBeenCalled();
    cleanup.resolve(); await login; await settle();
    expect(f.cache).toHaveBeenCalledWith('session-b', userB, expect.any(Function));
    expect(f.start).toHaveBeenCalledWith(userB);
  });
  it('ignores an old boot result after another identity has signed in', async () => {
    const response = deferred<any>(); f.cached.mockResolvedValue(userA); f.api.mockReturnValue(response.promise);
    render(); await settle();
    f.token = ''; (globalThis as any).window.dispatchEvent(new Event('hds:logout')); await settle();
    f.token = 'session-b'; await view.props.onDone(userB); await settle();
    response.resolve({ user: userA }); await settle();
    expect(f.start.mock.calls.at(-1)?.[0]).toEqual(userB);
    expect(f.cache.mock.calls.every(([token]) => token === 'session-b')).toBe(true);
  });
});
